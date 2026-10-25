package worker

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hauxyz/sendme/server/internal/config"
	"github.com/hauxyz/sendme/server/internal/crypto"
	"github.com/hauxyz/sendme/server/internal/mailer"
	"github.com/hauxyz/sendme/server/internal/queue"
	"github.com/hauxyz/sendme/server/internal/tracking"
)

const maxEmailAttempts = 4

type Worker struct {
	cfg     *config.Config
	db      *pgxpool.Pool
	queue   *queue.Client
	mailer  *mailer.Service
	sealer  *crypto.Sealer
	tracker *tracking.Service
	logger  *slog.Logger
	client  *http.Client
}

func New(cfg *config.Config, db *pgxpool.Pool, q *queue.Client, mailerSvc *mailer.Service, sealer *crypto.Sealer, tracker *tracking.Service, logger *slog.Logger) *Worker {
	return &Worker{
		cfg: cfg, db: db, queue: q, mailer: mailerSvc, sealer: sealer, tracker: tracker, logger: logger,
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func (w *Worker) Mux() *asynq.ServeMux {
	mux := asynq.NewServeMux()
	mux.HandleFunc(queue.TaskEmailSend, w.handleEmail)
	mux.HandleFunc(queue.TaskCampaignSend, w.handleCampaign)
	mux.HandleFunc(queue.TaskWebhookDeliver, w.handleWebhook)
	return mux
}

type emailJob struct {
	ID             string
	WorkspaceID    string
	DomainID       *string
	CampaignID     *string
	ToEmail        string
	ToName         string
	FromEmail      string
	FromName       string
	ReplyTo        string
	Subject        string
	HTML           string
	Text           string
	Status         string
	Attempts       int
	TrackingID     string
	TrackOpens     bool
	TrackClicks    bool
	UnsubscribeURL string
	Headers        []byte
}

func (w *Worker) handleEmail(ctx context.Context, task *asynq.Task) error {
	var payload queue.EmailSendPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("decode email payload: %w", err)
	}
	job, err := w.loadEmailJob(ctx, payload.EmailID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if job.Status == "sent" {
		return nil
	}

	var attempts int
	err = w.db.QueryRow(ctx, `
		UPDATE emails SET status = 'sending', attempts = attempts + 1, updated_at = now()
		WHERE id = $1 AND (status = 'queued' OR (status = 'sending' AND updated_at < now() - interval '3 minutes'))
		RETURNING attempts
	`, job.ID).Scan(&attempts)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}

	final := func(err error) error {
		message := truncate(err.Error(), 1000)
		if attempts >= maxEmailAttempts {
			_, _ = w.db.Exec(context.Background(), `
				UPDATE emails SET status = 'failed', error = $1, updated_at = now() WHERE id = $2
			`, message, job.ID)
			_, _ = w.db.Exec(context.Background(), `
				INSERT INTO email_events (email_id, type, url) VALUES ($1, 'failed', $2)
			`, job.ID, message)
			w.emitEmailEvent(job, "email.failed", map[string]any{"error": message, "attempts": attempts})
			w.checkCampaignCompletion(job.CampaignID)
		} else {
			_, _ = w.db.Exec(context.Background(), `
				UPDATE emails SET status = 'queued', error = $1, updated_at = now() WHERE id = $2
			`, message, job.ID)
			_, _ = w.db.Exec(context.Background(), `
				INSERT INTO email_events (email_id, type, url) VALUES ($1, 'send_failed', $2)
			`, job.ID, message)
		}
		return err
	}

	if job.DomainID == nil {
		return final(errors.New("sending domain has been removed"))
	}
	var domainName, smtpHost, security, auth, username, encryptedPassword string
	var smtpPort int
	err = w.db.QueryRow(ctx, `
		SELECT name, smtp_host, smtp_port, smtp_security, smtp_auth, smtp_username, smtp_password_enc
		FROM domains WHERE id = $1
	`, *job.DomainID).Scan(&domainName, &smtpHost, &smtpPort, &security, &auth, &username, &encryptedPassword)
	if err != nil {
		return final(fmt.Errorf("sending domain is unavailable: %w", err))
	}
	password, err := w.sealer.Decrypt(encryptedPassword)
	if err != nil {
		return final(fmt.Errorf("could not decrypt SMTP password: %w", err))
	}

	headers := map[string]string{}
	_ = json.Unmarshal(job.Headers, &headers)
	html := job.HTML
	if html != "" {
		html = w.tracker.RewriteHTML(html, job.TrackingID, job.TrackOpens, job.TrackClicks)
	}
	messageID := fmt.Sprintf("<%s@%s>", job.ID, domainName)
	err = w.mailer.Send(ctx, mailer.SMTPConfig{
		Host: smtpHost, Port: smtpPort, Security: security, Auth: auth,
		Username: username, Password: password, FromEmail: job.FromEmail, FromName: job.FromName, ReplyTo: job.ReplyTo,
	}, mailer.Message{
		To: job.ToEmail, ToName: job.ToName, Subject: job.Subject, HTML: html, Text: job.Text,
		Headers: headers, MessageID: messageID, UnsubscribeURL: job.UnsubscribeURL,
	})
	if err != nil {
		w.logger.Warn("email send failed", "email_id", job.ID, "attempt", attempts, "error", err)
		return final(err)
	}

	_, err = w.db.Exec(ctx, `
		UPDATE emails SET status = 'sent', error = '', sent_at = now(), message_id = $1, updated_at = now() WHERE id = $2
	`, messageID, job.ID)
	if err != nil {
		return fmt.Errorf("mark email sent: %w", err)
	}
	_, _ = w.db.Exec(ctx, `INSERT INTO email_events (email_id, type) VALUES ($1, 'sent')`, job.ID)
	w.emitEmailEvent(job, "email.sent", map[string]any{"message_id": messageID, "subject": job.Subject})
	w.checkCampaignCompletion(job.CampaignID)
	return nil
}

func (w *Worker) loadEmailJob(ctx context.Context, emailID string) (*emailJob, error) {
	var job emailJob
	err := w.db.QueryRow(ctx, `
		SELECT id, workspace_id, domain_id, campaign_id, to_email, to_name, from_email, from_name, reply_to,
			subject, html, text_content, status, attempts, tracking_id, track_opens, track_clicks, unsubscribe_url, headers
		FROM emails WHERE id = $1
	`, emailID).Scan(
		&job.ID, &job.WorkspaceID, &job.DomainID, &job.CampaignID, &job.ToEmail, &job.ToName, &job.FromEmail, &job.FromName, &job.ReplyTo,
		&job.Subject, &job.HTML, &job.Text, &job.Status, &job.Attempts, &job.TrackingID, &job.TrackOpens, &job.TrackClicks,
		&job.UnsubscribeURL, &job.Headers,
	)
	return &job, err
}

func (w *Worker) emitEmailEvent(job *emailJob, event string, extra map[string]any) {
	data := map[string]any{
		"email_id": job.ID,
		"to":       job.ToEmail,
		"from":     job.FromEmail,
	}
	if job.CampaignID != nil {
		data["campaign_id"] = *job.CampaignID
	}
	for key, value := range extra {
		data[key] = value
	}
	w.emitEvent(job.WorkspaceID, event, data)
}

func (w *Worker) handleCampaign(ctx context.Context, task *asynq.Task) error {
	var payload queue.CampaignSendPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("decode campaign payload: %w", err)
	}

	var status string
	if err := w.db.QueryRow(ctx, `SELECT status FROM campaigns WHERE id = $1`, payload.CampaignID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if status == "canceled" || status == "sent" || status == "failed" || status == "draft" {
		return nil
	}
	if status == "scheduled" {
		tag, err := w.db.Exec(ctx, `
			UPDATE campaigns SET status = 'sending', started_at = now(), updated_at = now()
			WHERE id = $1 AND status = 'scheduled'
		`, payload.CampaignID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
	}

	var workspaceID, name, subject, html, fromEmail, fromName, replyTo string
	var domainID, audienceID *string
	var trackOpens, trackClicks bool
	err := w.db.QueryRow(ctx, `
		SELECT c.workspace_id, c.name, c.subject, c.html, c.from_domain_id, c.audience_id,
			c.track_opens, c.track_clicks, COALESCE(d.from_email, ''), COALESCE(d.from_name, ''), COALESCE(d.reply_to, '')
		FROM campaigns c LEFT JOIN domains d ON d.id = c.from_domain_id
		WHERE c.id = $1
	`, payload.CampaignID).Scan(&workspaceID, &name, &subject, &html, &domainID, &audienceID,
		&trackOpens, &trackClicks, &fromEmail, &fromName, &replyTo)
	if err != nil {
		return err
	}
	if domainID == nil || audienceID == nil || fromEmail == "" {
		_, _ = w.db.Exec(ctx, `UPDATE campaigns SET status = 'failed', updated_at = now() WHERE id = $1`, payload.CampaignID)
		return fmt.Errorf("campaign is missing a sender or audience")
	}
	var domainExists bool
	if err := w.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM domains WHERE id = $1)`, *domainID).Scan(&domainExists); err != nil || !domainExists {
		_, _ = w.db.Exec(ctx, `UPDATE campaigns SET status = 'failed', updated_at = now() WHERE id = $1`, payload.CampaignID)
		return fmt.Errorf("campaign domain not found")
	}

	type recipient struct {
		ID        string
		Email     string
		FirstName string
		LastName  string
	}
	rows, err := w.db.Query(ctx, `
		SELECT c.id, c.email, c.first_name, c.last_name
		FROM audience_members am JOIN contacts c ON c.id = am.contact_id
		WHERE am.audience_id = $1 AND c.unsubscribed = false
		ORDER BY c.created_at ASC
	`, *audienceID)
	if err != nil {
		return err
	}
	recipients := make([]recipient, 0)
	for rows.Next() {
		var item recipient
		if err := rows.Scan(&item.ID, &item.Email, &item.FirstName, &item.LastName); err == nil {
			recipients = append(recipients, item)
		}
	}
	rows.Close()

	inserted := 0
	for _, contact := range recipients {
		unsubscribeURL := w.tracker.UnsubscribeURL(contact.ID)
		renderedHTML := renderTemplate(html, contact.Email, contact.FirstName, contact.LastName, unsubscribeURL)
		if !strings.Contains(strings.ToLower(html), "{{unsubscribe_url}}") {
			renderedHTML += tracking.UnsubscribeFooter(unsubscribeURL)
		}
		renderedSubject := renderTemplate(subject, contact.Email, contact.FirstName, contact.LastName, unsubscribeURL)
		if strings.TrimSpace(renderedSubject) == "" {
			renderedSubject = subject
		}
		textContent := tracking.PlainText(renderedHTML)
		trackingID := uuid.NewString()
		var emailID string
		err := w.db.QueryRow(ctx, `
			INSERT INTO emails (
				id, workspace_id, domain_id, campaign_id, contact_id, source,
				to_email, from_email, from_name, reply_to, subject, html, text_content,
				status, tracking_id, track_opens, track_clicks, unsubscribe_url, scheduled_at
			) VALUES ($1,$2,$3,$4,$5,'campaign',$6,$7,$8,$9,$10,$11,$12,'queued',$13,$14,$15,$16,now())
			ON CONFLICT (campaign_id, contact_id) WHERE campaign_id IS NOT NULL DO NOTHING
			RETURNING id
		`, uuid.NewString(), workspaceID, *domainID, payload.CampaignID, contact.ID,
			contact.Email, fromEmail, fromName, replyTo, renderedSubject, renderedHTML, textContent,
			trackingID, trackOpens, trackClicks, unsubscribeURL).Scan(&emailID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("create campaign email: %w", err)
		}
		inserted++
	}

	var total int
	_ = w.db.QueryRow(ctx, `SELECT count(*) FROM emails WHERE campaign_id = $1`, payload.CampaignID).Scan(&total)
	if _, err := w.db.Exec(ctx, `UPDATE campaigns SET total_recipients = $1, updated_at = now() WHERE id = $2`, total, payload.CampaignID); err != nil {
		return err
	}

	emailRows, err := w.db.Query(ctx, `
		SELECT id FROM emails WHERE campaign_id = $1 AND status = 'queued'
	`, payload.CampaignID)
	if err != nil {
		return err
	}
	queuedIDs := make([]string, 0)
	for emailRows.Next() {
		var id string
		if err := emailRows.Scan(&id); err == nil {
			queuedIDs = append(queuedIDs, id)
		}
	}
	emailRows.Close()
	for _, id := range queuedIDs {
		if err := w.queue.EnqueueEmail(id, time.Time{}); err != nil {
			return fmt.Errorf("enqueue campaign email: %w", err)
		}
	}

	w.logger.Info("campaign dispatched", "campaign_id", payload.CampaignID, "name", name, "recipients", total, "new_emails", inserted, "queued", len(queuedIDs))
	w.checkCampaignCompletion(&payload.CampaignID)
	return nil
}

func (w *Worker) checkCampaignCompletion(campaignID *string) {
	if campaignID == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tag, err := w.db.Exec(ctx, `
		UPDATE campaigns SET status = 'sent', completed_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'sending'
		AND NOT EXISTS (SELECT 1 FROM emails WHERE campaign_id = $1 AND status IN ('queued', 'sending'))
	`, *campaignID)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}
	var workspaceID, name string
	var sent, failed int
	err = w.db.QueryRow(ctx, `
		SELECT c.workspace_id, c.name,
			(SELECT count(*) FROM emails WHERE campaign_id = c.id AND status = 'sent'),
			(SELECT count(*) FROM emails WHERE campaign_id = c.id AND status = 'failed')
		FROM campaigns c WHERE c.id = $1
	`, *campaignID).Scan(&workspaceID, &name, &sent, &failed)
	if err != nil {
		return
	}
	w.emitEvent(workspaceID, "campaign.completed", map[string]any{
		"campaign_id": *campaignID,
		"name":        name,
		"sent":        sent,
		"failed":      failed,
	})
}

func renderTemplate(content, email, firstName, lastName, unsubscribeURL string) string {
	replacer := strings.NewReplacer(
		"{{email}}", email,
		"{{ email }}", email,
		"{{first_name}}", firstName,
		"{{ first_name }}", firstName,
		"{{last_name}}", lastName,
		"{{ last_name }}", lastName,
		"{{unsubscribe_url}}", unsubscribeURL,
		"{{ unsubscribe_url }}", unsubscribeURL,
	)
	return replacer.Replace(content)
}

func (w *Worker) handleWebhook(ctx context.Context, task *asynq.Task) error {
	var payload queue.WebhookDeliveryPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("decode webhook payload: %w", err)
	}

	var deliveryID, webhookID, event, secret, targetURL string
	var body []byte
	err := w.db.QueryRow(ctx, `
		SELECT d.id, d.webhook_id, d.event, d.payload, w.secret, w.url
		FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
		WHERE d.id = $1
	`, payload.DeliveryID).Scan(&deliveryID, &webhookID, &event, &body, &secret, &targetURL)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	var alreadyDelivered *time.Time
	if err := w.db.QueryRow(ctx, `SELECT delivered_at FROM webhook_deliveries WHERE id = $1`, deliveryID).Scan(&alreadyDelivered); err == nil && alreadyDelivered != nil {
		return nil
	}

	_, _ = w.db.Exec(ctx, `UPDATE webhook_deliveries SET attempts = attempts + 1 WHERE id = $1`, deliveryID)
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "." + string(body)))
	signature := "v1=" + hex.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "SendMe-Webhooks/1.0")
	req.Header.Set("X-SendMe-Event", event)
	req.Header.Set("X-SendMe-Delivery", deliveryID)
	req.Header.Set("X-SendMe-Timestamp", timestamp)
	req.Header.Set("X-SendMe-Signature", signature)

	resp, err := w.client.Do(req)
	if err != nil {
		_, _ = w.db.Exec(ctx, `UPDATE webhook_deliveries SET error = $1 WHERE id = $2`, truncate(err.Error(), 1000), deliveryID)
		return err
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	success := resp.StatusCode >= 200 && resp.StatusCode < 300
	if success {
		_, _ = w.db.Exec(ctx, `
			UPDATE webhook_deliveries
			SET status_code = $1, response_body = $2, error = '', delivered_at = now()
			WHERE id = $3
		`, resp.StatusCode, truncate(string(responseBody), 4000), deliveryID)
		return nil
	}
	message := fmt.Sprintf("endpoint returned HTTP %d", resp.StatusCode)
	_, _ = w.db.Exec(ctx, `
		UPDATE webhook_deliveries SET status_code = $1, response_body = $2, error = $3 WHERE id = $4
	`, resp.StatusCode, truncate(string(responseBody), 4000), message, deliveryID)
	return errors.New(message)
}

func (w *Worker) emitEvent(workspace string, event string, data map[string]any) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := w.db.Query(ctx, `
		SELECT id, url, secret, events FROM webhooks
		WHERE workspace_id = $1 AND enabled = true AND events ? $2
	`, workspace, event)
	if err != nil {
		w.logger.Error("load webhooks for worker event", "error", err)
		return
	}
	type hook struct {
		ID     string
		URL    string
		Secret string
	}
	hooks := []hook{}
	for rows.Next() {
		var item hook
		var events []byte
		if err := rows.Scan(&item.ID, &item.URL, &item.Secret, &events); err == nil {
			hooks = append(hooks, item)
		}
	}
	rows.Close()
	payload := map[string]any{
		"type":       event,
		"created_at": time.Now().UTC(),
		"data":       data,
	}
	body, _ := json.Marshal(payload)
	for _, item := range hooks {
		id := uuid.NewString()
		if _, err := w.db.Exec(ctx, `
			INSERT INTO webhook_deliveries (id, webhook_id, event, payload) VALUES ($1, $2, $3, $4)
		`, id, item.ID, event, string(body)); err != nil {
			continue
		}
		if err := w.queue.EnqueueWebhook(id); err != nil {
			w.logger.Error("enqueue webhook", "error", err)
		}
	}
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}

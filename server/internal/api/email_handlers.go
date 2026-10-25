package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hauxyz/sendme/server/internal/httpx"
	"github.com/hauxyz/sendme/server/internal/tracking"
)

type EmailSummary struct {
	ID           string     `json:"id"`
	ToEmail      string     `json:"to_email"`
	ToName       string     `json:"to_name"`
	FromEmail    string     `json:"from_email"`
	FromName     string     `json:"from_name"`
	Subject      string     `json:"subject"`
	Status       string     `json:"status"`
	Error        string     `json:"error"`
	Source       string     `json:"source"`
	DomainID     *string    `json:"domain_id"`
	DomainName   string     `json:"domain_name"`
	CampaignID   *string    `json:"campaign_id"`
	CampaignName string     `json:"campaign_name"`
	ContactID    *string    `json:"contact_id"`
	Opens        int        `json:"opens"`
	Clicks       int        `json:"clicks"`
	ScheduledAt  *time.Time `json:"scheduled_at"`
	SentAt       *time.Time `json:"sent_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

type EmailDetail struct {
	EmailSummary
	WorkspaceID   string          `json:"-"`
	HTML          string          `json:"html"`
	Text          string          `json:"text"`
	ReplyTo       string          `json:"reply_to"`
	Attempts      int             `json:"attempts"`
	TrackingID    string          `json:"tracking_id"`
	TrackOpens    bool            `json:"track_opens"`
	TrackClicks   bool            `json:"track_clicks"`
	FirstOpenedAt *time.Time      `json:"first_opened_at"`
	LastOpenedAt  *time.Time      `json:"last_opened_at"`
	MessageID     string          `json:"message_id"`
	Headers       json.RawMessage `json:"headers"`
	UpdatedAt     time.Time       `json:"updated_at"`
	Events        []EmailEvent    `json:"events,omitempty"`
}

type EmailEvent struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"`
	URL       string    `json:"url"`
	UserAgent string    `json:"user_agent"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"created_at"`
}

const emailSummarySelect = `
	SELECT e.id, e.to_email, e.to_name, e.from_email, e.from_name, e.subject, e.status, e.error,
		e.source, e.domain_id, COALESCE(d.name, ''), e.campaign_id, COALESCE(c.name, ''), e.contact_id,
		e.opens, e.clicks, e.scheduled_at, e.sent_at, e.created_at
	FROM emails e
	LEFT JOIN domains d ON d.id = e.domain_id
	LEFT JOIN campaigns c ON c.id = e.campaign_id
`

const emailDetailSelect = `
	SELECT e.id, e.to_email, e.to_name, e.from_email, e.from_name, e.subject, e.status, e.error,
		e.source, e.domain_id, COALESCE(d.name, ''), e.campaign_id, COALESCE(c.name, ''), e.contact_id,
		e.opens, e.clicks, e.scheduled_at, e.sent_at, e.created_at,
		e.workspace_id, e.html, e.text_content, e.reply_to, e.attempts, e.tracking_id,
		e.track_opens, e.track_clicks, e.first_opened_at, e.last_opened_at, e.message_id, e.headers, e.updated_at
	FROM emails e
	LEFT JOIN domains d ON d.id = e.domain_id
	LEFT JOIN campaigns c ON c.id = e.campaign_id
`

func scanEmailSummary(row pgx.Row) (EmailSummary, error) {
	var e EmailSummary
	err := row.Scan(&e.ID, &e.ToEmail, &e.ToName, &e.FromEmail, &e.FromName, &e.Subject, &e.Status, &e.Error,
		&e.Source, &e.DomainID, &e.DomainName, &e.CampaignID, &e.CampaignName, &e.ContactID,
		&e.Opens, &e.Clicks, &e.ScheduledAt, &e.SentAt, &e.CreatedAt)
	return e, err
}

func scanEmailDetail(row pgx.Row) (EmailDetail, error) {
	var e EmailDetail
	err := row.Scan(&e.ID, &e.ToEmail, &e.ToName, &e.FromEmail, &e.FromName, &e.Subject, &e.Status, &e.Error,
		&e.Source, &e.DomainID, &e.DomainName, &e.CampaignID, &e.CampaignName, &e.ContactID,
		&e.Opens, &e.Clicks, &e.ScheduledAt, &e.SentAt, &e.CreatedAt,
		&e.WorkspaceID, &e.HTML, &e.Text, &e.ReplyTo, &e.Attempts, &e.TrackingID,
		&e.TrackOpens, &e.TrackClicks, &e.FirstOpenedAt, &e.LastOpenedAt, &e.MessageID, &e.Headers, &e.UpdatedAt)
	return e, err
}

func (s *Server) listEmails(w http.ResponseWriter, r *http.Request) {
	s.listEmailsForWorkspace(w, r, workspaceID(r))
}

func (s *Server) listEmailsForWorkspace(w http.ResponseWriter, r *http.Request, workspace string) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	campaignID := strings.TrimSpace(r.URL.Query().Get("campaign_id"))
	source := strings.TrimSpace(r.URL.Query().Get("source"))
	limit := httpx.QueryLimit(r, 50, 200)
	offset := httpx.QueryOffset(r)

	where := []string{"e.workspace_id = $1"}
	args := []any{workspace}
	if search != "" {
		args = append(args, "%"+search+"%")
		n := len(args)
		where = append(where, fmt.Sprintf("(e.to_email::text ILIKE $%d OR e.subject ILIKE $%d)", n, n))
	}
	if status != "" && status != "all" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("e.status = $%d", len(args)))
	}
	if campaignID != "" {
		args = append(args, campaignID)
		where = append(where, fmt.Sprintf("e.campaign_id = $%d", len(args)))
	}
	if source != "" && source != "all" {
		args = append(args, source)
		where = append(where, fmt.Sprintf("e.source = $%d", len(args)))
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM emails e`+whereSQL, args...).Scan(&total); err != nil {
		s.logger.Error("count emails", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load emails")
		return
	}

	args = append(args, limit, offset)
	query := emailSummarySelect + whereSQL + fmt.Sprintf(" ORDER BY e.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		s.logger.Error("list emails", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load emails")
		return
	}
	defer rows.Close()

	emails := make([]EmailSummary, 0)
	for rows.Next() {
		e, err := scanEmailSummary(rows)
		if err != nil {
			s.logger.Error("scan email", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load emails")
			return
		}
		emails = append(emails, e)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"emails": emails, "total": total})
}

func (s *Server) getEmail(w http.ResponseWriter, r *http.Request) {
	email, err := s.loadEmailDetail(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "email_not_found", "Email not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"email": email})
}

func (s *Server) loadEmailDetail(ctx context.Context, workspace, emailID string) (*EmailDetail, error) {
	row := s.db.QueryRow(ctx, emailDetailSelect+` WHERE e.id = $1 AND e.workspace_id = $2`, emailID, workspace)
	email, err := scanEmailDetail(row)
	if err != nil {
		return nil, err
	}
	events, err := s.loadEmailEvents(ctx, emailID)
	if err != nil {
		return nil, err
	}
	email.Events = events
	return &email, nil
}

func (s *Server) loadEmailEvents(ctx context.Context, emailID string) ([]EmailEvent, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, type, url, user_agent, ip, created_at
		FROM email_events WHERE email_id = $1 ORDER BY created_at DESC LIMIT 100
	`, emailID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]EmailEvent, 0)
	for rows.Next() {
		var event EmailEvent
		if err := rows.Scan(&event.ID, &event.Type, &event.URL, &event.UserAgent, &event.IP, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}

type queueEmailParams struct {
	WorkspaceID    string
	Domain         *Domain
	CampaignID     *string
	ContactID      *string
	APIKeyID       *string
	Source         string
	To             string
	ToName         string
	FromName       string
	FromEmail      string
	ReplyTo        string
	Subject        string
	HTML           string
	Text           string
	Headers        map[string]string
	TrackOpens     bool
	TrackClicks    bool
	ScheduledAt    *time.Time
	IdempotencyKey string
	UnsubscribeURL string
}

func (s *Server) queueEmail(ctx context.Context, p queueEmailParams) (*EmailDetail, error) {
	if p.FromEmail == "" && p.Domain != nil {
		p.FromEmail = p.Domain.FromEmail
	}
	if p.FromName == "" && p.Domain != nil {
		p.FromName = p.Domain.FromName
	}
	if p.ReplyTo == "" && p.Domain != nil {
		p.ReplyTo = p.Domain.ReplyTo
	}
	if p.Text == "" && p.HTML != "" {
		p.Text = s.trackerPlainText(p.HTML)
	}
	headers, _ := json.Marshal(p.Headers)
	if len(headers) == 0 || string(headers) == "null" {
		headers = []byte("{}")
	}

	var domainID *string
	if p.Domain != nil {
		domainID = &p.Domain.ID
	}

	id := uuid.NewString()
	trackingID := uuid.NewString()
	scheduledAt := time.Now().UTC()
	if p.ScheduledAt != nil {
		scheduledAt = p.ScheduledAt.UTC()
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO emails (
			id, workspace_id, domain_id, campaign_id, contact_id, api_key_id, source,
			to_email, to_name, from_email, from_name, reply_to, subject, html, text_content,
			status, tracking_id, track_opens, track_clicks, unsubscribe_url, headers,
			idempotency_key, scheduled_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
			'queued',$16,$17,$18,$19,$20,$21,$22
		)
	`, id, p.WorkspaceID, domainID, p.CampaignID, p.ContactID, p.APIKeyID, p.Source,
		p.To, p.ToName, p.FromEmail, p.FromName, p.ReplyTo, p.Subject, p.HTML, p.Text,
		trackingID, p.TrackOpens, p.TrackClicks, p.UnsubscribeURL, headers,
		nullIfEmpty(p.IdempotencyKey), scheduledAt)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO email_events (email_id, type) VALUES ($1, 'queued')`, id); err != nil {
		s.logger.Error("insert queued event", "error", err)
	}
	if err := s.queue.EnqueueEmail(id, scheduledAt); err != nil {
		_, _ = s.db.Exec(ctx, `UPDATE emails SET status = 'failed', error = $1, updated_at = now() WHERE id = $2`, "Could not queue email: "+truncate(err.Error(), 500), id)
		return nil, fmt.Errorf("enqueue email: %w", err)
	}
	return s.loadEmailDetail(ctx, p.WorkspaceID, id)
}

func (s *Server) trackerPlainText(html string) string {
	return tracking.PlainText(html)
}

func (s *Server) sendDashboardEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DomainID    string `json:"domain_id"`
		To          string `json:"to"`
		Subject     string `json:"subject"`
		HTML        string `json:"html"`
		Text        string `json:"text"`
		ReplyTo     string `json:"reply_to"`
		ScheduledAt string `json:"scheduled_at"`
		TrackOpens  *bool  `json:"track_opens"`
		TrackClicks *bool  `json:"track_clicks"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.To = strings.TrimSpace(req.To)
	req.Subject = strings.TrimSpace(req.Subject)
	req.ReplyTo = strings.TrimSpace(req.ReplyTo)
	if !validEmail(req.To) {
		httpx.Error(w, http.StatusBadRequest, "invalid_recipient", "Enter a valid recipient email address")
		return
	}
	if req.Subject == "" || len(req.Subject) > 300 {
		httpx.Error(w, http.StatusBadRequest, "invalid_subject", "Subject must be between 1 and 300 characters")
		return
	}
	if strings.TrimSpace(req.HTML) == "" && strings.TrimSpace(req.Text) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_content", "Add HTML or text content to the email")
		return
	}
	if req.ReplyTo != "" && !validEmail(req.ReplyTo) {
		httpx.Error(w, http.StatusBadRequest, "invalid_reply_to", "Enter a valid reply-to address")
		return
	}
	var scheduledAt *time.Time
	if req.ScheduledAt != "" {
		parsed, err := time.Parse(time.RFC3339, req.ScheduledAt)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_schedule", "Scheduled time must be a valid ISO 8601 date")
			return
		}
		scheduledAt = &parsed
	}
	d, err := s.loadDomain(r.Context(), workspaceID(r), req.DomainID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_domain", "Select a valid sending domain")
		return
	}
	if d.Status != "active" {
		httpx.Error(w, http.StatusUnprocessableEntity, "domain_not_active", "Test the SMTP configuration for this domain before sending")
		return
	}
	trackOpens := true
	if req.TrackOpens != nil {
		trackOpens = *req.TrackOpens
	}
	trackClicks := true
	if req.TrackClicks != nil {
		trackClicks = *req.TrackClicks
	}
	email, err := s.queueEmail(r.Context(), queueEmailParams{
		WorkspaceID: workspaceID(r), Domain: d, Source: "dashboard",
		To: req.To, Subject: req.Subject, HTML: req.HTML, Text: req.Text, ReplyTo: req.ReplyTo,
		TrackOpens: trackOpens, TrackClicks: trackClicks, ScheduledAt: scheduledAt,
	})
	if err != nil {
		s.logger.Error("queue dashboard email", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not queue the email")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"email": email})
}

func (s *Server) retryEmail(w http.ResponseWriter, r *http.Request) {
	emailID := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE emails SET status = 'queued', error = '', attempts = 0, updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND status IN ('failed', 'queued')
	`, emailID, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not retry the email")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusConflict, "email_not_retryable", "Only failed or queued emails can be retried")
		return
	}
	if err := s.queue.EnqueueEmail(emailID, time.Time{}); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not queue the email")
		return
	}
	email, _ := s.loadEmailDetail(r.Context(), workspaceID(r), emailID)
	httpx.JSON(w, http.StatusOK, map[string]any{"email": email})
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (s *Server) v1SendEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		To          stringList        `json:"to"`
		From        string            `json:"from"`
		Domain      string            `json:"domain"`
		DomainID    string            `json:"domain_id"`
		Subject     string            `json:"subject"`
		HTML        string            `json:"html"`
		Text        string            `json:"text"`
		ReplyTo     string            `json:"reply_to"`
		ScheduledAt string            `json:"scheduled_at"`
		TrackOpens  *bool             `json:"track_opens"`
		TrackClicks *bool             `json:"track_clicks"`
		Headers     map[string]string `json:"headers"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	recipients := []string(req.To)
	if len(recipients) == 0 {
		httpx.Error(w, http.StatusBadRequest, "missing_recipient", "Provide at least one recipient in the to field")
		return
	}
	if len(recipients) > 50 {
		httpx.Error(w, http.StatusBadRequest, "too_many_recipients", "A maximum of 50 recipients is allowed per request")
		return
	}
	for i, recipient := range recipients {
		recipient = strings.TrimSpace(recipient)
		if !validEmail(recipient) {
			httpx.Error(w, http.StatusBadRequest, "invalid_recipient", fmt.Sprintf("Recipient %q is not a valid email address", recipient))
			return
		}
		recipients[i] = recipient
	}
	req.Subject = strings.TrimSpace(req.Subject)
	if req.Subject == "" || len(req.Subject) > 300 {
		httpx.Error(w, http.StatusBadRequest, "invalid_subject", "Subject must be between 1 and 300 characters")
		return
	}
	if strings.TrimSpace(req.HTML) == "" && strings.TrimSpace(req.Text) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_content", "Provide html or text content")
		return
	}
	if req.ReplyTo != "" && !validEmail(req.ReplyTo) {
		httpx.Error(w, http.StatusBadRequest, "invalid_reply_to", "reply_to must be a valid email address")
		return
	}
	if len(req.Headers) > 25 {
		httpx.Error(w, http.StatusBadRequest, "too_many_headers", "A maximum of 25 custom headers is allowed")
		return
	}

	workspace := workspaceID(r)
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(idempotencyKey) > 200 {
		httpx.Error(w, http.StatusBadRequest, "invalid_idempotency_key", "Idempotency-Key must be 200 characters or fewer")
		return
	}
	if idempotencyKey != "" && len(recipients) > 1 {
		httpx.Error(w, http.StatusBadRequest, "invalid_idempotency_key", "Idempotency-Key is only supported for a single recipient")
		return
	}
	if idempotencyKey != "" {
		var existingID string
		err := s.db.QueryRow(r.Context(), `SELECT id FROM emails WHERE workspace_id = $1 AND idempotency_key = $2`, workspace, idempotencyKey).Scan(&existingID)
		if err == nil {
			email, _ := s.loadEmailDetail(r.Context(), workspace, existingID)
			httpx.JSON(w, http.StatusOK, map[string]any{"id": existingID, "ids": []string{existingID}, "email": email})
			return
		}
	}

	fromName := ""
	fromEmail := ""
	if strings.TrimSpace(req.From) != "" {
		address, err := mail.ParseAddress(strings.TrimSpace(req.From))
		if err != nil || !validEmail(address.Address) {
			httpx.Error(w, http.StatusBadRequest, "invalid_from", "from must be a valid email address")
			return
		}
		fromEmail = strings.ToLower(address.Address)
		fromName = address.Name
	}

	d, err := s.resolveSendingDomain(r, workspace, req.Domain, req.DomainID, fromEmail)
	if err != nil {
		httpx.Error(w, http.StatusUnprocessableEntity, "invalid_domain", err.Error())
		return
	}
	if fromEmail == "" {
		fromEmail = d.FromEmail
	}
	if fromName == "" {
		fromName = d.FromName
	}
	fromDomain := fromEmail[strings.LastIndex(fromEmail, "@")+1:]
	if !strings.EqualFold(fromDomain, d.Name) {
		httpx.Error(w, http.StatusUnprocessableEntity, "from_domain_mismatch", "The from address must use the selected sending domain")
		return
	}

	var scheduledAt *time.Time
	if req.ScheduledAt != "" {
		parsed, err := time.Parse(time.RFC3339, req.ScheduledAt)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_schedule", "scheduled_at must be an ISO 8601 timestamp")
			return
		}
		scheduledAt = &parsed
	}
	trackOpens := true
	if req.TrackOpens != nil {
		trackOpens = *req.TrackOpens
	}
	trackClicks := true
	if req.TrackClicks != nil {
		trackClicks = *req.TrackClicks
	}
	keyID := apiKeyID(r)
	ids := make([]string, 0, len(recipients))
	for _, recipient := range recipients {
		idempotency := ""
		if idempotencyKey != "" {
			idempotency = idempotencyKey
		}
		email, err := s.queueEmail(r.Context(), queueEmailParams{
			WorkspaceID: workspace, Domain: d, APIKeyID: &keyID, Source: "api",
			To: recipient, FromEmail: fromEmail, FromName: fromName, ReplyTo: req.ReplyTo,
			Subject: req.Subject, HTML: req.HTML, Text: req.Text, Headers: req.Headers,
			TrackOpens: trackOpens, TrackClicks: trackClicks, ScheduledAt: scheduledAt,
			IdempotencyKey: idempotency,
		})
		if err != nil {
			if idempotencyKey != "" && isUniqueViolation(err) {
				var existingID string
				if queueErr := s.db.QueryRow(r.Context(), `SELECT id FROM emails WHERE workspace_id = $1 AND idempotency_key = $2`, workspace, idempotencyKey).Scan(&existingID); queueErr == nil {
					existing, _ := s.loadEmailDetail(r.Context(), workspace, existingID)
					httpx.JSON(w, http.StatusOK, map[string]any{"id": existingID, "ids": []string{existingID}, "email": existing})
					return
				}
			}
			s.logger.Error("queue api email", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not queue the email")
			return
		}
		ids = append(ids, email.ID)
	}

	response := map[string]any{"ids": ids}
	if len(ids) == 1 {
		response["id"] = ids[0]
		email, _ := s.loadEmailDetail(r.Context(), workspace, ids[0])
		response["email"] = email
	}
	httpx.JSON(w, http.StatusCreated, response)
}

func (s *Server) resolveSendingDomain(r *http.Request, workspace, domainName, domainID, fromEmail string) (*Domain, error) {
	var d Domain
	var err error
	if domainID != "" {
		d, err = s.loadDomainForAPI(r, workspace, "id", domainID)
		if err != nil {
			return nil, fmt.Errorf("the selected sending domain was not found or is not active")
		}
		return &d, nil
	}
	if domainName != "" {
		d, err = s.loadDomainForAPI(r, workspace, "name", normalizeDomain(domainName))
		if err != nil {
			return nil, fmt.Errorf("the sending domain %q was not found or is not active", normalizeDomain(domainName))
		}
		return &d, nil
	}
	if fromEmail != "" {
		parts := strings.SplitN(fromEmail, "@", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("the from address must include a valid domain")
		}
		d, err = s.loadDomainForAPI(r, workspace, "name", normalizeDomain(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("the from address domain %q was not found or is not active", normalizeDomain(parts[1]))
		}
		return &d, nil
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+domainColumns+` FROM domains WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at ASC`, workspace)
	if err != nil {
		return nil, fmt.Errorf("could not resolve a sending domain")
	}
	defer rows.Close()
	domains := []Domain{}
	for rows.Next() {
		var candidate Domain
		if err := scanDomain(rows, &candidate); err == nil {
			domains = append(domains, candidate)
		}
	}
	if len(domains) == 1 {
		return &domains[0], nil
	}
	if len(domains) == 0 {
		return nil, fmt.Errorf("no active sending domain found. Add a domain and test its SMTP configuration first")
	}
	return nil, fmt.Errorf("specify a sending domain using the from or domain field")
}

func (s *Server) loadDomainForAPI(r *http.Request, workspace, column, value string) (Domain, error) {
	var query string
	if column == "id" {
		query = `SELECT ` + domainColumns + ` FROM domains WHERE workspace_id = $1 AND id = $2 AND status = 'active'`
	} else {
		query = `SELECT ` + domainColumns + ` FROM domains WHERE workspace_id = $1 AND name = $2 AND status = 'active'`
	}
	var d Domain
	err := scanDomain(s.db.QueryRow(r.Context(), query, workspace, value), &d)
	return d, err
}

func (s *Server) v1ListEmails(w http.ResponseWriter, r *http.Request) {
	s.listEmailsForWorkspace(w, r, workspaceID(r))
}

func (s *Server) v1GetEmail(w http.ResponseWriter, r *http.Request) {
	email, err := s.loadEmailDetail(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "email_not_found", "Email not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"email": email})
}

func (s *Server) v1Me(w http.ResponseWriter, r *http.Request) {
	var workspaceName, keyName, prefix string
	err := s.db.QueryRow(r.Context(), `
		SELECT w.name, k.name, k.prefix
		FROM api_keys k JOIN workspaces w ON w.id = k.workspace_id
		WHERE k.id = $1
	`, apiKeyID(r)).Scan(&workspaceName, &keyName, &prefix)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the API key")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"workspace": map[string]string{"id": workspaceID(r), "name": workspaceName},
		"api_key":   map[string]string{"id": apiKeyID(r), "name": keyName, "prefix": prefix},
	})
}

func (s *Server) v1Domains(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, name, from_name, from_email, status, last_tested_at
		FROM domains WHERE workspace_id = $1 ORDER BY created_at ASC
	`, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load domains")
		return
	}
	defer rows.Close()
	type domain struct {
		ID           string     `json:"id"`
		Name         string     `json:"name"`
		FromName     string     `json:"from_name"`
		FromEmail    string     `json:"from_email"`
		Status       string     `json:"status"`
		LastTestedAt *time.Time `json:"last_tested_at"`
	}
	domains := make([]domain, 0)
	for rows.Next() {
		var d domain
		if err := rows.Scan(&d.ID, &d.Name, &d.FromName, &d.FromEmail, &d.Status, &d.LastTestedAt); err == nil {
			domains = append(domains, d)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"domains": domains})
}

func (s *Server) v1CreateContact(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email        string          `json:"email"`
		FirstName    string          `json:"first_name"`
		LastName     string          `json:"last_name"`
		Unsubscribed *bool           `json:"unsubscribed"`
		Metadata     json.RawMessage `json:"metadata"`
		AudienceID   string          `json:"audience_id"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if !validEmail(req.Email) {
		httpx.Error(w, http.StatusBadRequest, "invalid_email", "Enter a valid email address")
		return
	}
	if len(req.Metadata) == 0 || string(req.Metadata) == "null" {
		req.Metadata = json.RawMessage(`{}`)
	}
	if !json.Valid(req.Metadata) {
		httpx.Error(w, http.StatusBadRequest, "invalid_metadata", "metadata must be valid JSON")
		return
	}
	unsubscribed := false
	if req.Unsubscribed != nil {
		unsubscribed = *req.Unsubscribed
	}
	var contactID string
	err := s.db.QueryRow(r.Context(), `
		INSERT INTO contacts (id, workspace_id, email, first_name, last_name, unsubscribed, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (workspace_id, email) DO UPDATE SET
			first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			unsubscribed = EXCLUDED.unsubscribed,
			metadata = EXCLUDED.metadata,
			updated_at = now()
		RETURNING id
	`, uuid.NewString(), workspaceID(r), req.Email, strings.TrimSpace(req.FirstName), strings.TrimSpace(req.LastName), unsubscribed, string(req.Metadata)).Scan(&contactID)
	if err != nil {
		s.logger.Error("upsert api contact", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not save the contact")
		return
	}
	if req.AudienceID != "" {
		if _, err := s.db.Exec(r.Context(), `
			INSERT INTO audience_members (audience_id, contact_id)
			SELECT a.id, $1 FROM audiences a WHERE a.id = $2 AND a.workspace_id = $3
			ON CONFLICT DO NOTHING
		`, contactID, req.AudienceID, workspaceID(r)); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the contact to the audience")
			return
		}
	}
	row := s.db.QueryRow(r.Context(), contactSelect+` WHERE c.id = $1 AND c.workspace_id = $2`, contactID, workspaceID(r))
	contact, err := scanContact(row)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the contact")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"contact": contact})
}

func (s *Server) v1Audiences(w http.ResponseWriter, r *http.Request) {
	s.listAudiences(w, r)
}

type stringList []string

func (s *stringList) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		if strings.TrimSpace(single) != "" {
			*s = []string{single}
		}
		return nil
	}
	var multiple []string
	if err := json.Unmarshal(data, &multiple); err != nil {
		return errors.New("to must be a string or an array of strings")
	}
	*s = multiple
	return nil
}

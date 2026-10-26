package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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
		httpx.Error(w, http.StatusUnprocessableEntity, "domain_not_active", "Test the delivery configuration for this domain before sending")
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

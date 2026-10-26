package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hauxyz/sendme/server/internal/dkim"
	"github.com/hauxyz/sendme/server/internal/httpx"
	"github.com/hauxyz/sendme/server/internal/mailer"
)

// The v1 API mirrors the public useSend API shape so clients built for
// useSend can point at SendMe's /api/v1 proxy without changing payloads.
// The underlying data model still uses SendMe's per-recipient email rows.

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
		return errors.New("value must be a string or an array of strings")
	}
	*s = multiple
	return nil
}

type v1APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *v1APIError) Error() string { return e.Message }

func v1Err(status int, code, message string) error {
	return &v1APIError{Status: status, Code: code, Message: message}
}

func writeV1Error(w http.ResponseWriter, err error) {
	var apiErr *v1APIError
	if errors.As(err, &apiErr) {
		httpx.Error(w, apiErr.Status, apiErr.Code, apiErr.Message)
		return
	}
	httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "An unexpected error occurred")
}

func (s *Server) resolveSendingDomain(ctx context.Context, workspace, domainName, domainID, fromEmail string) (*Domain, error) {
	var d Domain
	var err error
	if domainID != "" {
		d, err = s.loadDomainForAPI(ctx, workspace, "id", domainID)
		if err != nil {
			return nil, fmt.Errorf("the selected sending domain was not found or is not active")
		}
		return &d, nil
	}
	if domainName != "" {
		d, err = s.loadDomainForAPI(ctx, workspace, "name", normalizeDomain(domainName))
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
		d, err = s.loadDomainForAPI(ctx, workspace, "name", normalizeDomain(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("the from address domain %q was not found or is not active", normalizeDomain(parts[1]))
		}
		return &d, nil
	}
	rows, err := s.db.Query(ctx, `SELECT `+domainColumns+` FROM domains WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at ASC`, workspace)
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
		return nil, fmt.Errorf("no active sending domain found. Add a domain and test its delivery configuration first")
	}
	return nil, fmt.Errorf("specify a sending domain using the from or domain field")
}

func (s *Server) loadDomainForAPI(ctx context.Context, workspace, column, value string) (Domain, error) {
	var query string
	if column == "id" {
		query = `SELECT ` + domainColumns + ` FROM domains WHERE workspace_id = $1 AND id = $2 AND status = 'active'`
	} else {
		query = `SELECT ` + domainColumns + ` FROM domains WHERE workspace_id = $1 AND name = $2 AND status = 'active'`
	}
	var d Domain
	err := scanDomain(s.db.QueryRow(ctx, query, workspace, value), &d)
	return d, err
}

type v1Attachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

type v1SendEmailRequest struct {
	To                stringList        `json:"to"`
	From              string            `json:"from"`
	Subject           string            `json:"subject"`
	ReplyTo           stringList        `json:"replyTo"`
	ReplyToLegacy     stringList        `json:"reply_to"`
	CC                stringList        `json:"cc"`
	BCC               stringList        `json:"bcc"`
	HTML              *string           `json:"html"`
	Text              *string           `json:"text"`
	Headers           map[string]string `json:"headers"`
	Attachments       []v1Attachment    `json:"attachments"`
	ScheduledAt       string            `json:"scheduledAt"`
	ScheduledAtLegacy string            `json:"scheduled_at"`
	InReplyToID       *string           `json:"inReplyToId"`
	TemplateID        string            `json:"templateId"`
	Variables         map[string]string `json:"variables"`
	Domain            string            `json:"domain"`
	DomainID          string            `json:"domain_id"`
	TrackOpens        *bool             `json:"trackOpens"`
	TrackClicks       *bool             `json:"trackClicks"`
	TrackOpensLegacy  *bool             `json:"track_opens"`
	TrackClicksLegacy *bool             `json:"track_clicks"`
}

func firstString(values stringList) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func (s *Server) prepareV1Email(ctx context.Context, workspace, keyID string, req *v1SendEmailRequest) ([]queueEmailParams, error) {
	if strings.TrimSpace(req.TemplateID) != "" {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Templates are not supported by this SendMe instance. Provide subject, html or text instead.")
	}
	if len(req.Variables) > 0 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Template variables are not supported by this SendMe instance.")
	}
	if len(req.Attachments) > 0 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Attachments are not supported by this SendMe instance.")
	}
	if len(req.CC) > 0 || len(req.BCC) > 0 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "CC and BCC recipients are not supported by this SendMe instance.")
	}

	recipients := make([]string, 0, len(req.To))
	for _, recipient := range req.To {
		recipient = strings.TrimSpace(recipient)
		if !validEmail(recipient) {
			return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", fmt.Sprintf("Recipient %q is not a valid email address", recipient))
		}
		recipients = append(recipients, recipient)
	}
	if len(recipients) == 0 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Provide at least one recipient in the to field")
	}
	if len(recipients) > 50 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "A maximum of 50 recipients is allowed per request")
	}

	from := strings.TrimSpace(req.From)
	if from == "" {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "The from field is required")
	}
	address, err := parseAddress(from)
	if err != nil || !validEmail(address.Address) {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "from must be a valid email address")
	}

	subject := strings.TrimSpace(req.Subject)
	if subject == "" || len(subject) > 300 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Subject must be between 1 and 300 characters")
	}

	html, text := "", ""
	if req.HTML != nil {
		html = *req.HTML
	}
	if req.Text != nil {
		text = *req.Text
	}
	if strings.TrimSpace(html) == "" && strings.TrimSpace(text) == "" {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Provide html or text content")
	}

	replyToValues := req.ReplyTo
	if len(replyToValues) == 0 {
		replyToValues = req.ReplyToLegacy
	}
	replyTo := firstString(replyToValues)
	if replyTo != "" && !validEmail(replyTo) {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "replyTo must be a valid email address")
	}

	if len(req.Headers) > 25 {
		return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "A maximum of 25 custom headers is allowed")
	}
	for key, value := range req.Headers {
		if strings.TrimSpace(key) == "" || strings.ContainsAny(key, "\r\n") || strings.ContainsAny(value, "\r\n") {
			return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "Custom headers cannot be empty or contain newlines")
		}
	}
	if req.InReplyToID != nil && strings.TrimSpace(*req.InReplyToID) != "" {
		if strings.ContainsAny(*req.InReplyToID, "\r\n") {
			return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "inReplyToId is invalid")
		}
		if req.Headers == nil {
			req.Headers = map[string]string{}
		}
		req.Headers["In-Reply-To"] = "<" + strings.Trim(*req.InReplyToID, "<>") + ">"
	}

	scheduledRaw := strings.TrimSpace(req.ScheduledAt)
	if scheduledRaw == "" {
		scheduledRaw = strings.TrimSpace(req.ScheduledAtLegacy)
	}
	var scheduledAt *time.Time
	if scheduledRaw != "" {
		parsed, err := time.Parse(time.RFC3339, scheduledRaw)
		if err != nil {
			return nil, v1Err(http.StatusBadRequest, "BAD_REQUEST", "scheduledAt must be an ISO 8601 timestamp")
		}
		scheduledAt = &parsed
	}

	trackOpens := true
	if req.TrackOpens != nil {
		trackOpens = *req.TrackOpens
	} else if req.TrackOpensLegacy != nil {
		trackOpens = *req.TrackOpensLegacy
	}
	trackClicks := true
	if req.TrackClicks != nil {
		trackClicks = *req.TrackClicks
	} else if req.TrackClicksLegacy != nil {
		trackClicks = *req.TrackClicksLegacy
	}

	fromEmail := strings.ToLower(address.Address)
	fromName := address.Name
	d, err := s.resolveSendingDomain(ctx, workspace, req.Domain, req.DomainID, fromEmail)
	if err != nil {
		return nil, v1Err(http.StatusUnprocessableEntity, "BAD_REQUEST", err.Error())
	}
	if fromName == "" {
		fromName = d.FromName
	}
	fromDomain := fromEmail[strings.LastIndex(fromEmail, "@")+1:]
	if !strings.EqualFold(fromDomain, d.Name) {
		return nil, v1Err(http.StatusUnprocessableEntity, "BAD_REQUEST", "The from address must use the selected sending domain")
	}

	params := make([]queueEmailParams, 0, len(recipients))
	for _, recipient := range recipients {
		params = append(params, queueEmailParams{
			WorkspaceID: workspace, Domain: d, APIKeyID: &keyID, Source: "api",
			To: recipient, FromEmail: fromEmail, FromName: fromName, ReplyTo: replyTo,
			Subject: subject, HTML: html, Text: text, Headers: req.Headers,
			TrackOpens: trackOpens, TrackClicks: trackClicks, ScheduledAt: scheduledAt,
		})
	}
	return params, nil
}

func (s *Server) v1SendEmail(w http.ResponseWriter, r *http.Request) {
	var req v1SendEmailRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(idempotencyKey) > 256 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Idempotency-Key must be 256 characters or fewer")
		return
	}
	if idempotencyKey != "" && len(req.To) > 1 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Idempotency-Key is only supported for a single recipient")
		return
	}

	workspace := workspaceID(r)
	keyID := apiKeyID(r)
	params, err := s.prepareV1Email(r.Context(), workspace, keyID, &req)
	if err != nil {
		writeV1Error(w, err)
		return
	}

	if idempotencyKey != "" {
		if existingID, ok := s.findIdempotentEmail(r.Context(), workspace, idempotencyKey); ok {
			httpx.JSON(w, http.StatusOK, map[string]any{"emailId": existingID})
			return
		}
		params[0].IdempotencyKey = idempotencyKey
	}

	ids := make([]string, 0, len(params))
	for _, param := range params {
		email, err := s.queueEmail(r.Context(), param)
		if err != nil {
			if idempotencyKey != "" && isUniqueViolation(err) {
				if existingID, ok := s.findIdempotentEmail(r.Context(), workspace, idempotencyKey); ok {
					httpx.JSON(w, http.StatusOK, map[string]any{"emailId": existingID})
					return
				}
			}
			s.logger.Error("queue api email", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not queue the email")
			return
		}
		ids = append(ids, email.ID)
	}

	response := map[string]any{"emailId": ids[0]}
	if len(ids) > 1 {
		response["emailIds"] = ids
	}
	httpx.JSON(w, http.StatusOK, response)
}

func (s *Server) findIdempotentEmail(ctx context.Context, workspace, key string) (string, bool) {
	var existingID string
	err := s.db.QueryRow(ctx, `SELECT id FROM emails WHERE workspace_id = $1 AND idempotency_key = $2`, workspace, key).Scan(&existingID)
	return existingID, err == nil
}

func (s *Server) v1BatchEmails(w http.ResponseWriter, r *http.Request) {
	var requests []v1SendEmailRequest
	if !httpx.DecodeJSON(w, r, &requests) {
		return
	}
	if len(requests) == 0 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Provide at least one email")
		return
	}
	if len(requests) > 100 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "A maximum of 100 emails is allowed per batch")
		return
	}
	if strings.TrimSpace(r.Header.Get("Idempotency-Key")) != "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Idempotency-Key is only supported for single-email requests")
		return
	}

	workspace := workspaceID(r)
	keyID := apiKeyID(r)
	prepared := make([][]queueEmailParams, 0, len(requests))
	for i := range requests {
		params, err := s.prepareV1Email(r.Context(), workspace, keyID, &requests[i])
		if err != nil {
			writeV1Error(w, err)
			return
		}
		prepared = append(prepared, params)
	}

	data := make([]map[string]string, 0, len(requests))
	for _, params := range prepared {
		for _, param := range params {
			email, err := s.queueEmail(r.Context(), param)
			if err != nil {
				s.logger.Error("queue batch api email", "error", err)
				httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not queue the email")
				return
			}
			data = append(data, map[string]string{"emailId": email.ID})
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": data})
}

type v1EmailListItem struct {
	ID           string  `json:"id"`
	To           string  `json:"to"`
	ReplyTo      *string `json:"replyTo"`
	CC           *string `json:"cc"`
	BCC          *string `json:"bcc"`
	From         string  `json:"from"`
	Subject      string  `json:"subject"`
	HTML         *string `json:"html"`
	Text         *string `json:"text"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
	LatestStatus string  `json:"latestStatus"`
	ScheduledAt  *string `json:"scheduledAt"`
	DomainID     *string `json:"domainId"`
}

type v1EmailEvent struct {
	EmailID   string `json:"emailId"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	Data      any    `json:"data,omitempty"`
}

type v1EmailDetail struct {
	ID          string         `json:"id"`
	TeamID      int            `json:"teamId"`
	To          string         `json:"to"`
	ReplyTo     *string        `json:"replyTo"`
	CC          *string        `json:"cc"`
	BCC         *string        `json:"bcc"`
	From        string         `json:"from"`
	Subject     string         `json:"subject"`
	HTML        *string        `json:"html"`
	Text        *string        `json:"text"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
	ScheduledAt *string        `json:"scheduledAt"`
	DomainID    *string        `json:"domainId"`
	EmailEvents []v1EmailEvent `json:"emailEvents"`
}

func v1Address(name, email string) string {
	if strings.TrimSpace(name) == "" {
		return email
	}
	return fmt.Sprintf("%s <%s>", name, email)
}

func v1StringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func v1TimeString(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func v1Status(status string, opens, clicks int, scheduledAt *time.Time) string {
	switch status {
	case "queued":
		if scheduledAt != nil && scheduledAt.After(time.Now()) {
			return "SCHEDULED"
		}
		return "QUEUED"
	case "sending":
		return "QUEUED"
	case "sent":
		switch {
		case clicks > 0:
			return "CLICKED"
		case opens > 0:
			return "OPENED"
		default:
			return "DELIVERED"
		}
	case "failed":
		return "FAILED"
	case "canceled":
		return "CANCELLED"
	default:
		return strings.ToUpper(status)
	}
}

func v1EventStatus(eventType string) string {
	switch eventType {
	case "queued":
		return "QUEUED"
	case "sent":
		return "DELIVERED"
	case "failed", "send_failed":
		return "FAILED"
	case "opened":
		return "OPENED"
	case "clicked":
		return "CLICKED"
	case "canceled":
		return "CANCELLED"
	default:
		return strings.ToUpper(eventType)
	}
}

func (s *Server) v1ListEmails(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	page := 1
	if raw := strings.TrimSpace(query.Get("page")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			page = parsed
		}
	}
	limit := 50
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if limit > 200 {
		limit = 200
	}

	where := []string{"e.workspace_id = $1"}
	args := []any{workspaceID(r)}
	if raw := strings.TrimSpace(query.Get("startDate")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "startDate must be an ISO 8601 timestamp")
			return
		}
		args = append(args, parsed)
		where = append(where, fmt.Sprintf("e.created_at >= $%d", len(args)))
	}
	if raw := strings.TrimSpace(query.Get("endDate")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "endDate must be an ISO 8601 timestamp")
			return
		}
		args = append(args, parsed)
		where = append(where, fmt.Sprintf("e.created_at <= $%d", len(args)))
	}
	domainIDs := []string{}
	for _, raw := range query["domainId"] {
		for _, part := range strings.Split(raw, ",") {
			if part = strings.TrimSpace(part); part != "" {
				domainIDs = append(domainIDs, part)
			}
		}
	}
	if len(domainIDs) > 0 {
		args = append(args, domainIDs)
		where = append(where, fmt.Sprintf("e.domain_id::text = ANY($%d)", len(args)))
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var count int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM emails e`+whereSQL, args...).Scan(&count); err != nil {
		s.logger.Error("count v1 emails", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load emails")
		return
	}

	args = append(args, limit, (page-1)*limit)
	rows, err := s.db.Query(r.Context(), `
		SELECT e.id, e.to_email, e.reply_to, e.from_email, e.from_name, e.subject, e.html, e.text_content,
			e.created_at, e.updated_at, e.status, e.opens, e.clicks, e.scheduled_at, e.domain_id
		FROM emails e`+whereSQL+fmt.Sprintf(` ORDER BY e.created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		s.logger.Error("list v1 emails", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load emails")
		return
	}
	defer rows.Close()

	data := make([]v1EmailListItem, 0)
	for rows.Next() {
		var item v1EmailListItem
		var replyTo, html, text, domainID *string
		var fromName string
		var createdAt, updatedAt time.Time
		var status string
		var opens, clicks int
		var scheduledAt *time.Time
		if err := rows.Scan(&item.ID, &item.To, &replyTo, &item.From, &fromName, &item.Subject, &html, &text,
			&createdAt, &updatedAt, &status, &opens, &clicks, &scheduledAt, &domainID); err != nil {
			s.logger.Error("scan v1 email", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load emails")
			return
		}
		item.To = v1Address("", item.To)
		item.From = v1Address(fromName, item.From)
		if replyTo != nil {
			item.ReplyTo = v1StringPtr(*replyTo)
		}
		if html != nil {
			item.HTML = v1StringPtr(*html)
		}
		if text != nil {
			item.Text = v1StringPtr(*text)
		}
		item.CreatedAt = v1TimeString(createdAt)
		item.UpdatedAt = v1TimeString(updatedAt)
		item.LatestStatus = v1Status(status, opens, clicks, scheduledAt)
		if scheduledAt != nil {
			formatted := v1TimeString(*scheduledAt)
			item.ScheduledAt = &formatted
		}
		item.DomainID = domainID
		data = append(data, item)
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"data": data, "count": count})
}

func (s *Server) v1GetEmail(w http.ResponseWriter, r *http.Request) {
	email, err := s.loadEmailDetail(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Email not found")
		return
	}
	events := make([]v1EmailEvent, 0, len(email.Events))
	for _, event := range email.Events {
		item := v1EmailEvent{
			EmailID:   email.ID,
			Status:    v1EventStatus(event.Type),
			CreatedAt: v1TimeString(event.CreatedAt),
		}
		if event.URL != "" {
			if event.Type == "clicked" {
				item.Data = map[string]any{"url": event.URL}
			} else {
				item.Data = map[string]any{"message": event.URL}
			}
		}
		events = append(events, item)
	}
	detail := v1EmailDetail{
		ID: email.ID, TeamID: 0, To: email.ToEmail, ReplyTo: v1StringPtr(email.ReplyTo),
		From: v1Address(email.FromName, email.FromEmail), Subject: email.Subject,
		HTML: v1StringPtr(email.HTML), Text: v1StringPtr(email.Text),
		CreatedAt: v1TimeString(email.CreatedAt), UpdatedAt: v1TimeString(email.UpdatedAt),
		DomainID: email.DomainID, EmailEvents: events,
	}
	if email.ScheduledAt != nil {
		formatted := v1TimeString(*email.ScheduledAt)
		detail.ScheduledAt = &formatted
	}
	httpx.JSON(w, http.StatusOK, detail)
}

func (s *Server) v1UpdateEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ScheduledAt string `json:"scheduledAt"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	scheduled, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "scheduledAt must be an ISO 8601 timestamp")
		return
	}
	emailID := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE emails SET scheduled_at = $1, updated_at = now()
		WHERE id = $2 AND workspace_id = $3 AND status = 'queued'
	`, scheduled, emailID, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not update the email")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Email not found or it can no longer be scheduled")
		return
	}
	if err := s.queue.EnqueueEmail(emailID, scheduled); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not reschedule the email")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"emailId": emailID})
}

func (s *Server) v1CancelEmail(w http.ResponseWriter, r *http.Request) {
	emailID := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE emails SET status = 'canceled', updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND status = 'queued'
	`, emailID, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not cancel the email")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Email not found or it has already been sent")
		return
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO email_events (email_id, type) VALUES ($1, 'canceled')`, emailID)
	httpx.JSON(w, http.StatusOK, map[string]string{"emailId": emailID})
}

type v1DNSRecord struct {
	Type        string  `json:"type"`
	Name        string  `json:"name"`
	Value       string  `json:"value"`
	TTL         string  `json:"ttl"`
	Priority    *string `json:"priority"`
	Status      string  `json:"status"`
	Recommended bool    `json:"recommended"`
}

type v1Domain struct {
	ID                string        `json:"id"`
	Name              string        `json:"name"`
	TeamID            int           `json:"teamId"`
	Status            string        `json:"status"`
	Region            string        `json:"region"`
	ClickTracking     bool          `json:"clickTracking"`
	OpenTracking      bool          `json:"openTracking"`
	PublicKey         string        `json:"publicKey"`
	DKIMStatus        *string       `json:"dkimStatus"`
	SPFDetails        *string       `json:"spfDetails"`
	CreatedAt         string        `json:"createdAt"`
	UpdatedAt         string        `json:"updatedAt"`
	DMARCAdded        bool          `json:"dmarcAdded"`
	IsVerifying       bool          `json:"isVerifying"`
	ErrorMessage      *string       `json:"errorMessage"`
	Subdomain         *string       `json:"subdomain"`
	VerificationError *string       `json:"verificationError"`
	LastCheckedTime   *string       `json:"lastCheckedTime"`
	DNSRecords        []v1DNSRecord `json:"dnsRecords"`
}

func v1DomainStatus(status string) string {
	switch status {
	case "active":
		return "SUCCESS"
	case "error":
		return "FAILED"
	default:
		return "PENDING"
	}
}

func (s *Server) v1Domain(d *Domain) v1Domain {
	status := v1DomainStatus(d.Status)
	spf := s.spfRecommendedRecord()
	records := []v1DNSRecord{
		{Type: "TXT", Name: d.Name, Value: spf, TTL: "Auto", Status: status, Recommended: true},
	}
	if d.DeliveryMode == mailer.ModeDirect {
		selector := d.DKIMSelector
		if selector == "" {
			selector = dkim.DefaultSelector
		}
		dkimStatus := status
		if strings.TrimSpace(d.DKIMPublicKey) == "" {
			dkimStatus = "PENDING"
		}
		records = append(records, v1DNSRecord{
			Type: "TXT", Name: selector + "._domainkey." + d.Name, Value: d.DKIMPublicKey,
			TTL: "Auto", Status: dkimStatus, Recommended: true,
		})
	}
	records = append(records, v1DNSRecord{
		Type: "TXT", Name: "_dmarc." + d.Name, Value: "v=DMARC1; p=none; rua=mailto:postmaster@" + d.Name,
		TTL: "Auto", Status: status, Recommended: true,
	})

	item := v1Domain{
		ID: d.ID, Name: d.Name, TeamID: 0, Status: status, Region: "self-hosted",
		ClickTracking: true, OpenTracking: true, PublicKey: d.DKIMPublicKey,
		CreatedAt: v1TimeString(d.CreatedAt), UpdatedAt: v1TimeString(d.UpdatedAt),
		DMARCAdded: false, IsVerifying: false, SPFDetails: &spf, DNSRecords: records,
	}
	if d.LastError != "" {
		item.ErrorMessage = &d.LastError
	}
	if d.LastTestedAt != nil {
		formatted := v1TimeString(*d.LastTestedAt)
		item.LastCheckedTime = &formatted
	}
	if d.DKIMPublicKey != "" {
		dkimStatus := status
		item.DKIMStatus = &dkimStatus
	}
	return item
}

func (s *Server) v1ListDomains(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT `+domainColumns+` FROM domains WHERE workspace_id = $1 ORDER BY created_at ASC`, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load domains")
		return
	}
	defer rows.Close()
	domains := make([]v1Domain, 0)
	for rows.Next() {
		var d Domain
		if err := scanDomain(rows, &d); err != nil {
			s.logger.Error("scan v1 domain", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load domains")
			return
		}
		domains = append(domains, s.v1Domain(&d))
	}
	httpx.JSON(w, http.StatusOK, domains)
}

func (s *Server) v1GetDomain(w http.ResponseWriter, r *http.Request) {
	d, err := s.loadDomain(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Domain not found")
		return
	}
	httpx.JSON(w, http.StatusOK, s.v1Domain(d))
}

func (s *Server) v1CreateDomain(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		Region     string `json:"region"`
		FromName   string `json:"fromName"`
		FromEmail  string `json:"fromEmail"`
		Delivery   string `json:"deliveryMode"`
		From       string `json:"from"`
		FromLegacy string `json:"from_email"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	name := normalizeDomain(req.Name)
	if !validDomain(name) {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Enter a valid domain name")
		return
	}
	if req.Delivery != "" && req.Delivery != mailer.ModeDirect {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "API domain creation only supports direct delivery. Configure SMTP relays from the dashboard.")
		return
	}
	fromEmail := strings.ToLower(strings.TrimSpace(req.FromEmail))
	if fromEmail == "" {
		fromEmail = strings.ToLower(strings.TrimSpace(req.FromLegacy))
	}
	if fromEmail == "" {
		fromEmail = "noreply@" + name
	}
	if !validEmail(fromEmail) {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "fromEmail must be a valid email address")
		return
	}
	fromName := strings.TrimSpace(req.FromName)
	if fromName == "" {
		fromName = "SendMe"
	}

	selector := dkim.DefaultSelector
	privatePEM, publicRecord, err := dkim.Generate()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not generate a DKIM key")
		return
	}
	encryptedDKIM, err := s.sealer.Encrypt(privatePEM)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not save the DKIM key")
		return
	}
	id := uuid.NewString()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO domains (
			id, workspace_id, name, from_name, from_email, reply_to,
			smtp_host, smtp_port, smtp_security, smtp_auth, smtp_username, smtp_password_enc,
			delivery_mode, dkim_selector, dkim_private_key_enc, dkim_public_key, status
		) VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,'',$11,$12,$13,$14,'pending')
	`, id, workspaceID(r), name, fromName, fromEmail, "", 0, "starttls", "none", "", mailer.ModeDirect, selector, encryptedDKIM, publicRecord)
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "NOT_UNIQUE", "This domain is already configured")
			return
		}
		s.logger.Error("create v1 domain", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not create the domain")
		return
	}
	d, err := s.loadDomain(r.Context(), workspaceID(r), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load the domain")
		return
	}
	httpx.JSON(w, http.StatusOK, s.v1Domain(d))
}

func (s *Server) v1DeleteDomain(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `DELETE FROM domains WHERE id = $1 AND workspace_id = $2`, id, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not delete the domain")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Domain not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": id, "success": true, "message": "Domain deleted successfully"})
}

func (s *Server) v1VerifyDomain(w http.ResponseWriter, r *http.Request) {
	d, err := s.loadDomain(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Domain not found")
		return
	}
	if d.Status == "active" {
		httpx.JSON(w, http.StatusOK, map[string]string{"message": "Domain is already verified"})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{
		"message": "DNS checks are available from the dashboard. Run a delivery test there to activate this domain.",
	})
}

func (s *Server) v1Me(w http.ResponseWriter, r *http.Request) {
	var workspaceName, keyName, prefix string
	err := s.db.QueryRow(r.Context(), `
		SELECT w.name, k.name, k.prefix
		FROM api_keys k JOIN workspaces w ON w.id = k.workspace_id
		WHERE k.id = $1
	`, apiKeyID(r)).Scan(&workspaceName, &keyName, &prefix)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load the API key")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"workspace": map[string]string{"id": workspaceID(r), "name": workspaceName},
		"apiKey":    map[string]string{"id": apiKeyID(r), "name": keyName, "prefix": prefix},
	})
}

// ---------------------------------------------------------------------------
// Contact books
// ---------------------------------------------------------------------------

type v1ContactBook struct {
	ID                 string            `json:"id"`
	Name               string            `json:"name"`
	TeamID             int               `json:"teamId"`
	Properties         map[string]string `json:"properties"`
	Variables          []string          `json:"variables"`
	Emoji              string            `json:"emoji"`
	DoubleOptInEnabled bool              `json:"doubleOptInEnabled"`
	DoubleOptInFrom    *string           `json:"doubleOptInFrom"`
	DoubleOptInSubject *string           `json:"doubleOptInSubject"`
	DoubleOptInContent *string           `json:"doubleOptInContent"`
	CreatedAt          string            `json:"createdAt"`
	UpdatedAt          string            `json:"updatedAt"`
	Count              map[string]int    `json:"_count"`
}

type v1Contact struct {
	ID            string            `json:"id"`
	FirstName     *string           `json:"firstName"`
	LastName      *string           `json:"lastName"`
	Email         string            `json:"email"`
	Subscribed    bool              `json:"subscribed"`
	Properties    map[string]string `json:"properties"`
	ContactBookID string            `json:"contactBookId"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
}

type v1ContactInput struct {
	Email      string            `json:"email"`
	FirstName  string            `json:"firstName"`
	LastName   string            `json:"lastName"`
	Properties map[string]string `json:"properties"`
	Subscribed *bool             `json:"subscribed"`
}

func (s *Server) loadV1ContactBook(ctx context.Context, workspace, id string) (*v1ContactBook, error) {
	var book v1ContactBook
	var createdAt, updatedAt time.Time
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT a.id, a.name, a.created_at, a.updated_at,
			(SELECT count(*) FROM audience_members am WHERE am.audience_id = a.id)
		FROM audiences a WHERE a.id = $1 AND a.workspace_id = $2
	`, id, workspace).Scan(&book.ID, &book.Name, &createdAt, &updatedAt, &count)
	if err != nil {
		return nil, err
	}
	book.TeamID = 0
	book.Properties = map[string]string{}
	book.Variables = []string{}
	book.Emoji = "📇"
	book.CreatedAt = v1TimeString(createdAt)
	book.UpdatedAt = v1TimeString(updatedAt)
	book.Count = map[string]int{"contacts": count}
	return &book, nil
}

func (s *Server) v1ListContactBooks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT a.id, a.name, a.created_at, a.updated_at,
			(SELECT count(*) FROM audience_members am WHERE am.audience_id = a.id)
		FROM audiences a WHERE a.workspace_id = $1 ORDER BY a.created_at DESC
	`, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load contact books")
		return
	}
	defer rows.Close()
	books := make([]v1ContactBook, 0)
	for rows.Next() {
		var book v1ContactBook
		var createdAt, updatedAt time.Time
		var count int
		if err := rows.Scan(&book.ID, &book.Name, &createdAt, &updatedAt, &count); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load contact books")
			return
		}
		book.TeamID = 0
		book.Properties = map[string]string{}
		book.Variables = []string{}
		book.Emoji = "📇"
		book.CreatedAt = v1TimeString(createdAt)
		book.UpdatedAt = v1TimeString(updatedAt)
		book.Count = map[string]int{"contacts": count}
		books = append(books, book)
	}
	httpx.JSON(w, http.StatusOK, books)
}

func (s *Server) v1CreateContactBook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string            `json:"name"`
		Description string            `json:"description"`
		Emoji       string            `json:"emoji"`
		Properties  map[string]string `json:"properties"`
		Variables   []string          `json:"variables"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 120 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Name must be between 1 and 120 characters")
		return
	}
	id := uuid.NewString()
	if _, err := s.db.Exec(r.Context(), `INSERT INTO audiences (id, workspace_id, name, description) VALUES ($1,$2,$3,$4)`,
		id, workspaceID(r), name, strings.TrimSpace(req.Description)); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not create the contact book")
		return
	}
	book, err := s.loadV1ContactBook(r.Context(), workspaceID(r), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load the contact book")
		return
	}
	httpx.JSON(w, http.StatusOK, book)
}

func (s *Server) v1GetContactBook(w http.ResponseWriter, r *http.Request) {
	book, err := s.loadV1ContactBook(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	httpx.JSON(w, http.StatusOK, book)
}

func (s *Server) v1UpdateContactBook(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), id); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || len(name) > 120 {
			httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Name must be between 1 and 120 characters")
			return
		}
		_, _ = s.db.Exec(r.Context(), `UPDATE audiences SET name = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3`, name, id, workspaceID(r))
	}
	if req.Description != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE audiences SET description = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3`, strings.TrimSpace(*req.Description), id, workspaceID(r))
	}
	book, _ := s.loadV1ContactBook(r.Context(), workspaceID(r), id)
	httpx.JSON(w, http.StatusOK, book)
}

func (s *Server) v1DeleteContactBook(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `DELETE FROM audiences WHERE id = $1 AND workspace_id = $2`, id, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not delete the contact book")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": id, "success": true, "message": "Contact book deleted successfully"})
}

func metadataProperties(raw json.RawMessage) map[string]string {
	properties := map[string]string{}
	if len(raw) == 0 {
		return properties
	}
	var values map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		return properties
	}
	for key, value := range values {
		switch typed := value.(type) {
		case string:
			properties[key] = typed
		case nil:
			properties[key] = ""
		default:
			properties[key] = fmt.Sprint(typed)
		}
	}
	return properties
}

func propertiesMetadata(properties map[string]string) json.RawMessage {
	if properties == nil {
		properties = map[string]string{}
	}
	raw, _ := json.Marshal(properties)
	return raw
}

func (s *Server) scanV1Contact(row pgx.Row, bookID string) (v1Contact, error) {
	var contact v1Contact
	var first, last string
	var metadata []byte
	var unsubscribed bool
	var createdAt, updatedAt time.Time
	if err := row.Scan(&contact.ID, &contact.Email, &first, &last, &unsubscribed, &metadata, &createdAt, &updatedAt); err != nil {
		return contact, err
	}
	contact.FirstName = v1StringPtr(first)
	contact.LastName = v1StringPtr(last)
	contact.Subscribed = !unsubscribed
	contact.Properties = metadataProperties(metadata)
	contact.ContactBookID = bookID
	contact.CreatedAt = v1TimeString(createdAt)
	contact.UpdatedAt = v1TimeString(updatedAt)
	return contact, nil
}

func (s *Server) v1ListContacts(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), bookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	query := r.URL.Query()
	where := []string{"am.audience_id = $1", "c.workspace_id = $2"}
	args := []any{bookID, workspaceID(r)}
	if raw := strings.TrimSpace(query.Get("ids")); raw != "" {
		ids := []string{}
		for _, part := range strings.Split(raw, ",") {
			if part = strings.TrimSpace(part); part != "" {
				ids = append(ids, part)
			}
		}
		if len(ids) > 0 {
			args = append(args, ids)
			where = append(where, fmt.Sprintf("c.id::text = ANY($%d)", len(args)))
		}
	}
	if raw := strings.TrimSpace(query.Get("emails")); raw != "" {
		emails := []string{}
		for _, part := range strings.Split(raw, ",") {
			if part = strings.TrimSpace(part); part != "" {
				emails = append(emails, strings.ToLower(part))
			}
		}
		if len(emails) > 0 {
			args = append(args, emails)
			where = append(where, fmt.Sprintf("lower(c.email::text) = ANY($%d)", len(args)))
		}
	}
	page, limit := 1, 1000
	if raw := strings.TrimSpace(query.Get("page")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			page = parsed
		}
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 5000 {
			limit = parsed
		}
	}
	args = append(args, limit, (page-1)*limit)
	rows, err := s.db.Query(r.Context(), `
		SELECT c.id, c.email, c.first_name, c.last_name, c.unsubscribed, c.metadata, c.created_at, c.updated_at
		FROM contacts c JOIN audience_members am ON am.contact_id = c.id
		WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY c.created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load contacts")
		return
	}
	defer rows.Close()
	contacts := make([]v1Contact, 0)
	for rows.Next() {
		contact, err := s.scanV1Contact(rows, bookID)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load contacts")
			return
		}
		contacts = append(contacts, contact)
	}
	httpx.JSON(w, http.StatusOK, contacts)
}

func (s *Server) v1GetContact(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), bookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	contact, err := s.scanV1Contact(s.db.QueryRow(r.Context(), `
		SELECT c.id, c.email, c.first_name, c.last_name, c.unsubscribed, c.metadata, c.created_at, c.updated_at
		FROM contacts c JOIN audience_members am ON am.contact_id = c.id
		WHERE am.audience_id = $1 AND c.id = $2 AND c.workspace_id = $3
	`, bookID, contactID, workspaceID(r)), bookID)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact not found")
		return
	}
	httpx.JSON(w, http.StatusOK, contact)
}

func (s *Server) upsertV1Contact(ctx context.Context, workspace, bookID string, req v1ContactInput) (string, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if !validEmail(email) {
		return "", v1Err(http.StatusBadRequest, "BAD_REQUEST", "Enter a valid email address")
	}
	firstName := strings.TrimSpace(req.FirstName)
	lastName := strings.TrimSpace(req.LastName)
	if len(firstName) > 100 || len(lastName) > 100 {
		return "", v1Err(http.StatusBadRequest, "BAD_REQUEST", "Names must be 100 characters or fewer")
	}
	unsubscribed := false
	if req.Subscribed != nil {
		unsubscribed = !*req.Subscribed
	}
	metadata := propertiesMetadata(req.Properties)
	var contactID string
	err := s.db.QueryRow(ctx, `
		INSERT INTO contacts (id, workspace_id, email, first_name, last_name, unsubscribed, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (workspace_id, email) DO UPDATE SET
			first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			unsubscribed = EXCLUDED.unsubscribed,
			metadata = EXCLUDED.metadata,
			updated_at = now()
		RETURNING id
	`, uuid.NewString(), workspace, email, firstName, lastName, unsubscribed, string(metadata)).Scan(&contactID)
	if err != nil {
		return "", err
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO audience_members (audience_id, contact_id)
		VALUES ($1, $2) ON CONFLICT DO NOTHING
	`, bookID, contactID); err != nil {
		return "", err
	}
	return contactID, nil
}

func (s *Server) v1AddContact(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), bookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	var req v1ContactInput
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	id, err := s.upsertV1Contact(r.Context(), workspaceID(r), bookID, req)
	if err != nil {
		writeV1Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"contactId": id})
}

func (s *Server) v1UpdateContact(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), bookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	var member bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM audience_members WHERE audience_id = $1 AND contact_id = $2)`, bookID, contactID).Scan(&member); err != nil || !member {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact not found")
		return
	}
	var req struct {
		FirstName  *string           `json:"firstName"`
		LastName   *string           `json:"lastName"`
		Properties map[string]string `json:"properties"`
		Subscribed *bool             `json:"subscribed"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	set := []string{}
	args := []any{}
	if req.FirstName != nil {
		args = append(args, strings.TrimSpace(*req.FirstName))
		set = append(set, fmt.Sprintf("first_name = $%d", len(args)))
	}
	if req.LastName != nil {
		args = append(args, strings.TrimSpace(*req.LastName))
		set = append(set, fmt.Sprintf("last_name = $%d", len(args)))
	}
	if req.Properties != nil {
		args = append(args, string(propertiesMetadata(req.Properties)))
		set = append(set, fmt.Sprintf("metadata = $%d", len(args)))
	}
	if req.Subscribed != nil {
		args = append(args, !*req.Subscribed)
		set = append(set, fmt.Sprintf("unsubscribed = $%d", len(args)))
	}
	if len(set) == 0 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "No fields to update")
		return
	}
	set = append(set, "updated_at = now()")
	args = append(args, contactID, workspaceID(r))
	if _, err := s.db.Exec(r.Context(), fmt.Sprintf("UPDATE contacts SET %s WHERE id = $%d AND workspace_id = $%d", strings.Join(set, ", "), len(args)-1, len(args)), args...); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not update the contact")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"contactId": contactID})
}

func (s *Server) v1DeleteContact(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")
	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM audience_members am USING audiences a
		WHERE am.audience_id = a.id AND a.workspace_id = $1 AND am.audience_id = $2 AND am.contact_id = $3
	`, workspaceID(r), bookID, contactID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not delete the contact")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) v1BulkAddContacts(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), bookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	var contacts []v1ContactInput
	if !httpx.DecodeJSON(w, r, &contacts) {
		return
	}
	if len(contacts) > 1000 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "A maximum of 1000 contacts is allowed per request")
		return
	}
	for _, contact := range contacts {
		if _, err := s.upsertV1Contact(r.Context(), workspaceID(r), bookID, contact); err != nil {
			writeV1Error(w, err)
			return
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"message": "Contacts added successfully", "count": len(contacts)})
}

func (s *Server) v1BulkDeleteContacts(w http.ResponseWriter, r *http.Request) {
	bookID := chi.URLParam(r, "id")
	if _, err := s.loadV1ContactBook(r.Context(), workspaceID(r), bookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Contact book not found")
		return
	}
	var req struct {
		ContactIDs []string `json:"contactIds"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.ContactIDs) == 0 || len(req.ContactIDs) > 1000 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "contactIds must contain between 1 and 1000 IDs")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM audience_members WHERE audience_id = $1 AND contact_id::text = ANY($2)`, bookID, req.ContactIDs)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not delete contacts")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "count": tag.RowsAffected()})
}

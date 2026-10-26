package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/hauxyz/sendme/server/internal/httpx"
)

type v1Campaign struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	From               string   `json:"from"`
	Subject            string   `json:"subject"`
	PreviewText        *string  `json:"previewText"`
	ContactBookID      *string  `json:"contactBookId"`
	HTML               *string  `json:"html"`
	Content            *string  `json:"content"`
	Status             string   `json:"status"`
	ScheduledAt        *string  `json:"scheduledAt"`
	BatchSize          int      `json:"batchSize"`
	BatchWindowMinutes int      `json:"batchWindowMinutes"`
	Total              int      `json:"total"`
	Sent               int      `json:"sent"`
	Delivered          int      `json:"delivered"`
	Opened             int      `json:"opened"`
	Clicked            int      `json:"clicked"`
	Unsubscribed       int      `json:"unsubscribed"`
	Bounced            int      `json:"bounced"`
	HardBounced        int      `json:"hardBounced"`
	Complained         int      `json:"complained"`
	ReplyTo            []string `json:"replyTo"`
	CC                 []string `json:"cc"`
	BCC                []string `json:"bcc"`
	CreatedAt          string   `json:"createdAt"`
	UpdatedAt          string   `json:"updatedAt"`
}

func v1CampaignStatus(status string) string {
	switch status {
	case "scheduled":
		return "SCHEDULED"
	case "sending":
		return "RUNNING"
	case "sent":
		return "SENT"
	case "canceled", "failed":
		return "PAUSED"
	default:
		return "DRAFT"
	}
}

func (s *Server) v1CampaignFromModel(c Campaign) v1Campaign {
	item := v1Campaign{
		ID: c.ID, Name: c.Name, From: v1Address(c.FromName, c.FromEmail), Subject: c.Subject,
		Status: v1CampaignStatus(c.Status), Total: c.TotalRecipients, Sent: c.SentCount,
		Delivered: c.SentCount, Opened: c.OpenedCount, Clicked: c.ClickedCount,
		Bounced: c.FailedCount, HardBounced: c.FailedCount,
		ReplyTo: []string{}, CC: []string{}, BCC: []string{},
		CreatedAt: v1TimeString(c.CreatedAt), UpdatedAt: v1TimeString(c.UpdatedAt),
	}
	if c.PreviewText != "" {
		item.PreviewText = &c.PreviewText
	}
	if c.AudienceID != nil {
		item.ContactBookID = c.AudienceID
	}
	if c.HTML != "" {
		html := c.HTML
		item.HTML = &html
		item.Content = &html
	}
	if c.ReplyTo != "" {
		item.ReplyTo = []string{c.ReplyTo}
	}
	if c.ScheduledAt != nil {
		formatted := v1TimeString(*c.ScheduledAt)
		item.ScheduledAt = &formatted
	}
	return item
}

func (s *Server) v1ListCampaigns(w http.ResponseWriter, r *http.Request) {
	page := 1
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			page = parsed
		}
	}
	const limit = 20

	where := []string{"c.workspace_id = $1"}
	args := []any{workspaceID(r)}
	if status := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status"))); status != "" {
		switch status {
		case "DRAFT":
			where = append(where, "c.status = 'draft'")
		case "SCHEDULED":
			where = append(where, "c.status = 'scheduled'")
		case "RUNNING":
			where = append(where, "c.status = 'sending'")
		case "SENT":
			where = append(where, "c.status = 'sent'")
		case "PAUSED":
			where = append(where, "c.status IN ('canceled', 'failed')")
		default:
			httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "status must be one of DRAFT, SCHEDULED, RUNNING, PAUSED or SENT")
			return
		}
	}
	if search := strings.TrimSpace(r.URL.Query().Get("search")); search != "" {
		args = append(args, "%"+search+"%")
		where = append(where, fmt.Sprintf("(c.name ILIKE $%d OR c.subject ILIKE $%d)", len(args), len(args)))
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM campaigns c`+whereSQL, args...).Scan(&total); err != nil {
		s.logger.Error("count v1 campaigns", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load campaigns")
		return
	}
	args = append(args, limit, (page-1)*limit)
	rows, err := s.db.Query(r.Context(), campaignSelect+whereSQL+fmt.Sprintf(" ORDER BY c.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		s.logger.Error("list v1 campaigns", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load campaigns")
		return
	}
	defer rows.Close()

	campaigns := make([]v1Campaign, 0)
	for rows.Next() {
		campaign, err := scanCampaign(rows)
		if err != nil {
			s.logger.Error("scan v1 campaign", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load campaigns")
			return
		}
		campaigns = append(campaigns, s.v1CampaignFromModel(campaign))
	}
	totalPage := (total + limit - 1) / limit
	httpx.JSON(w, http.StatusOK, map[string]any{"campaigns": campaigns, "totalPage": totalPage})
}

func (s *Server) v1GetCampaign(w http.ResponseWriter, r *http.Request) {
	campaign, err := s.getCampaignByIDContext(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Campaign not found")
		return
	}
	httpx.JSON(w, http.StatusOK, s.v1CampaignFromModel(campaign))
}

func (s *Server) v1CreateCampaign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string     `json:"name"`
		From          string     `json:"from"`
		Subject       string     `json:"subject"`
		PreviewText   string     `json:"previewText"`
		ContactBookID string     `json:"contactBookId"`
		Content       *string    `json:"content"`
		HTML          *string    `json:"html"`
		ReplyTo       stringList `json:"replyTo"`
		CC            stringList `json:"cc"`
		BCC           stringList `json:"bcc"`
		SendNow       bool       `json:"sendNow"`
		ScheduledAt   string     `json:"scheduledAt"`
		BatchSize     *int       `json:"batchSize"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Subject = strings.TrimSpace(req.Subject)
	if req.Name == "" || len(req.Name) > 160 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Name must be between 1 and 160 characters")
		return
	}
	if req.Subject == "" || len(req.Subject) > 300 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Subject must be between 1 and 300 characters")
		return
	}
	if len(req.PreviewText) > 300 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "previewText must be 300 characters or fewer")
		return
	}
	if len(req.CC) > 0 || len(req.BCC) > 0 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "CC and BCC recipients are not supported for campaigns on this SendMe instance")
		return
	}
	if len(req.ReplyTo) > 1 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Only one replyTo address is supported for campaigns")
		return
	}
	if req.BatchSize != nil && *req.BatchSize > 0 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Campaign batchSize is not supported on this SendMe instance")
		return
	}
	replyTo := firstString(req.ReplyTo)
	if replyTo != "" && !validEmail(replyTo) {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "replyTo must be a valid email address")
		return
	}

	fromAddress, err := parseAddress(strings.TrimSpace(req.From))
	if err != nil || !validEmail(fromAddress.Address) {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "from must be a valid email address")
		return
	}
	domain, err := s.resolveSendingDomain(r.Context(), workspaceID(r), "", "", fromAddress.Address)
	if err != nil {
		httpx.Error(w, http.StatusUnprocessableEntity, "BAD_REQUEST", err.Error())
		return
	}
	var contactBookExists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM audiences WHERE id = $1 AND workspace_id = $2)`, req.ContactBookID, workspaceID(r)).Scan(&contactBookExists); err != nil || !contactBookExists {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "contactBookId must reference an existing contact book")
		return
	}

	html := ""
	if req.HTML != nil && strings.TrimSpace(*req.HTML) != "" {
		html = *req.HTML
	} else if req.Content != nil {
		html = *req.Content
	}
	if strings.TrimSpace(html) == "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Provide html or content for the campaign")
		return
	}

	var scheduledAt *time.Time
	if req.SendNow && strings.TrimSpace(req.ScheduledAt) != "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Provide either sendNow or scheduledAt, not both")
		return
	}
	if raw := strings.TrimSpace(req.ScheduledAt); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "scheduledAt must be an ISO 8601 timestamp")
			return
		}
		scheduledAt = &parsed
	}
	if req.SendNow {
		now := time.Now().UTC()
		scheduledAt = &now
	}

	id := uuid.NewString()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO campaigns (
			id, workspace_id, name, subject, preview_text, from_domain_id, audience_id,
			html, from_email, from_name, reply_to
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, id, workspaceID(r), req.Name, req.Subject, strings.TrimSpace(req.PreviewText), domain.ID, req.ContactBookID,
		html, fromAddress.Address, fromAddress.Name, replyTo)
	if err != nil {
		s.logger.Error("create v1 campaign", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not create the campaign")
		return
	}

	if scheduledAt != nil {
		if _, failure := s.scheduleCampaign(r.Context(), workspaceID(r), id, *scheduledAt); failure != nil {
			httpx.Error(w, failure.Status, strings.ToUpper(strings.ReplaceAll(failure.Code, "internal_error", "INTERNAL_SERVER_ERROR")), failure.Message)
			return
		}
	}
	campaign, err := s.getCampaignByIDContext(r.Context(), workspaceID(r), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load the campaign")
		return
	}
	httpx.JSON(w, http.StatusOK, s.v1CampaignFromModel(campaign))
}

func (s *Server) v1DeleteCampaign(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	campaign, err := s.getCampaignByIDContext(r.Context(), workspaceID(r), id)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Campaign not found")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status IN ('draft', 'canceled')`, id, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not delete the campaign")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusConflict, "CONFLICT", "Only draft or canceled campaigns can be deleted")
		return
	}
	httpx.JSON(w, http.StatusOK, s.v1CampaignFromModel(campaign))
}

func (s *Server) v1ScheduleCampaign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ScheduledAt string `json:"scheduledAt"`
		BatchSize   *int   `json:"batchSize"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.BatchSize != nil && *req.BatchSize > 0 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Campaign batchSize is not supported on this SendMe instance")
		return
	}
	scheduledAt, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "scheduledAt must be an ISO 8601 timestamp")
		return
	}
	_, failure := s.scheduleCampaign(r.Context(), workspaceID(r), chi.URLParam(r, "id"), scheduledAt)
	if failure != nil {
		httpx.Error(w, failure.Status, strings.ToUpper(strings.ReplaceAll(failure.Code, "internal_error", "INTERNAL_SERVER_ERROR")), failure.Message)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) v1PauseCampaign(w http.ResponseWriter, r *http.Request) {
	httpx.Error(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "Pausing campaigns is not supported by this SendMe instance")
}

func (s *Server) v1ResumeCampaign(w http.ResponseWriter, r *http.Request) {
	httpx.Error(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "Resuming campaigns is not supported by this SendMe instance")
}

type v1TimeSeriesPoint struct {
	Date       string `json:"date"`
	Sent       int    `json:"sent"`
	Delivered  int    `json:"delivered"`
	Opened     int    `json:"opened"`
	Clicked    int    `json:"clicked"`
	Bounced    int    `json:"bounced"`
	Complained int    `json:"complained"`
}

type v1TimeSeriesTotals struct {
	Sent       int `json:"sent"`
	Delivered  int `json:"delivered"`
	Opened     int `json:"opened"`
	Clicked    int `json:"clicked"`
	Bounced    int `json:"bounced"`
	Complained int `json:"complained"`
}

func (s *Server) v1EmailTimeSeries(w http.ResponseWriter, r *http.Request) {
	days := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw == "7" {
		days = 7
	}
	args := []any{workspaceID(r), days}
	domainFilter := ""
	if domainID := strings.TrimSpace(r.URL.Query().Get("domainId")); domainID != "" {
		args = append(args, domainID)
		domainFilter = fmt.Sprintf(" AND e.domain_id::text = $%d", len(args))
	}
	rows, err := s.db.Query(r.Context(), fmt.Sprintf(`
		WITH day_range AS (
			SELECT generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day')::date AS day
		), stats AS (
			SELECT date_trunc('day', e.created_at)::date AS day,
				count(*) FILTER (WHERE e.status = 'sent') AS sent,
				count(*) FILTER (WHERE e.status = 'failed') AS bounced,
				count(*) FILTER (WHERE e.opens > 0) AS opened,
				count(*) FILTER (WHERE e.clicks > 0) AS clicked
			FROM emails e
			WHERE e.workspace_id = $1 AND e.created_at >= CURRENT_DATE - ($2::int - 1)%s
			GROUP BY 1
		)
		SELECT to_char(d.day, 'YYYY-MM-DD'), COALESCE(st.sent, 0), COALESCE(st.sent, 0),
			COALESCE(st.opened, 0), COALESCE(st.clicked, 0), COALESCE(st.bounced, 0), 0
		FROM day_range d LEFT JOIN stats st ON st.day = d.day
		ORDER BY d.day ASC
	`, domainFilter), args...)
	if err != nil {
		s.logger.Error("v1 email time series", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load analytics")
		return
	}
	defer rows.Close()

	result := make([]v1TimeSeriesPoint, 0, days)
	totals := v1TimeSeriesTotals{}
	for rows.Next() {
		var point v1TimeSeriesPoint
		if err := rows.Scan(&point.Date, &point.Sent, &point.Delivered, &point.Opened, &point.Clicked, &point.Bounced, &point.Complained); err != nil {
			s.logger.Error("scan v1 email time series", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load analytics")
			return
		}
		result = append(result, point)
		totals.Sent += point.Sent
		totals.Delivered += point.Delivered
		totals.Opened += point.Opened
		totals.Clicked += point.Clicked
		totals.Bounced += point.Bounced
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"result": result, "totalCounts": totals})
}

func (s *Server) v1ReputationMetrics(w http.ResponseWriter, r *http.Request) {
	args := []any{workspaceID(r)}
	domainFilter := ""
	if domainID := strings.TrimSpace(r.URL.Query().Get("domainId")); domainID != "" {
		args = append(args, domainID)
		domainFilter = fmt.Sprintf(" AND domain_id::text = $%d", len(args))
	}
	var delivered, hardBounced int
	if err := s.db.QueryRow(r.Context(), `
		SELECT count(*) FILTER (WHERE status = 'sent'), count(*) FILTER (WHERE status = 'failed')
		FROM emails WHERE workspace_id = $1`+domainFilter, args...).Scan(&delivered, &hardBounced); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Could not load analytics")
		return
	}
	bounceRate := 0.0
	if delivered+hardBounced > 0 {
		bounceRate = float64(hardBounced) / float64(delivered+hardBounced) * 100
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"delivered": delivered, "hardBounced": hardBounced, "complained": 0,
		"bounceRate": bounceRate, "complaintRate": 0.0,
	})
}

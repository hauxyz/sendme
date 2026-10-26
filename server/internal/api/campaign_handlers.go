package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hauxyz/sendme/server/internal/httpx"
)

type Campaign struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Subject         string     `json:"subject"`
	PreviewText     string     `json:"preview_text"`
	FromDomainID    *string    `json:"from_domain_id"`
	FromEmail       string     `json:"from_email"`
	FromName        string     `json:"from_name"`
	ReplyTo         string     `json:"reply_to"`
	DomainName      string     `json:"domain_name"`
	AudienceID      *string    `json:"audience_id"`
	AudienceName    string     `json:"audience_name"`
	HTML            string     `json:"html"`
	Status          string     `json:"status"`
	ScheduledAt     *time.Time `json:"scheduled_at"`
	StartedAt       *time.Time `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at"`
	TrackOpens      bool       `json:"track_opens"`
	TrackClicks     bool       `json:"track_clicks"`
	TotalRecipients int        `json:"total_recipients"`
	SentCount       int        `json:"sent_count"`
	FailedCount     int        `json:"failed_count"`
	QueuedCount     int        `json:"queued_count"`
	OpenedCount     int        `json:"opened_count"`
	ClickedCount    int        `json:"clicked_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

const campaignSelect = `
	SELECT c.id, c.name, c.subject, c.preview_text, c.from_domain_id,
		COALESCE(NULLIF(c.from_email, ''), d.from_email, '') AS from_email,
		COALESCE(NULLIF(c.from_name, ''), d.from_name, '') AS from_name,
		COALESCE(NULLIF(c.reply_to, ''), d.reply_to, '') AS reply_to,
		COALESCE(d.name, '') AS domain_name,
		c.audience_id, COALESCE(a.name, '') AS audience_name, c.html, c.status,
		c.scheduled_at, c.started_at, c.completed_at, c.track_opens, c.track_clicks,
		c.total_recipients, c.created_at, c.updated_at,
		(SELECT count(*) FROM emails e WHERE e.campaign_id = c.id AND e.status = 'sent') AS sent_count,
		(SELECT count(*) FROM emails e WHERE e.campaign_id = c.id AND e.status = 'failed') AS failed_count,
		(SELECT count(*) FROM emails e WHERE e.campaign_id = c.id AND e.status IN ('queued','sending')) AS queued_count,
		(SELECT count(*) FROM emails e WHERE e.campaign_id = c.id AND e.opens > 0) AS opened_count,
		(SELECT count(*) FROM emails e WHERE e.campaign_id = c.id AND e.clicks > 0) AS clicked_count
	FROM campaigns c
	LEFT JOIN domains d ON d.id = c.from_domain_id
	LEFT JOIN audiences a ON a.id = c.audience_id
`

func scanCampaign(row pgx.Row) (Campaign, error) {
	var c Campaign
	err := row.Scan(
		&c.ID, &c.Name, &c.Subject, &c.PreviewText, &c.FromDomainID,
		&c.FromEmail, &c.FromName, &c.ReplyTo, &c.DomainName,
		&c.AudienceID, &c.AudienceName, &c.HTML, &c.Status,
		&c.ScheduledAt, &c.StartedAt, &c.CompletedAt, &c.TrackOpens, &c.TrackClicks,
		&c.TotalRecipients, &c.CreatedAt, &c.UpdatedAt,
		&c.SentCount, &c.FailedCount, &c.QueuedCount, &c.OpenedCount, &c.ClickedCount,
	)
	return c, err
}

func (s *Server) listCampaigns(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	args := []any{workspaceID(r)}
	where := " WHERE c.workspace_id = $1"
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND c.status = $%d", len(args))
	}
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM campaigns c`+where, args...).Scan(&total); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load campaigns")
		return
	}
	args = append(args, httpx.QueryLimit(r, 50, 200), httpx.QueryOffset(r))
	query := campaignSelect + where + fmt.Sprintf(" ORDER BY c.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		s.logger.Error("list campaigns", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load campaigns")
		return
	}
	defer rows.Close()
	campaigns := make([]Campaign, 0)
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			s.logger.Error("scan campaign", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load campaigns")
			return
		}
		campaigns = append(campaigns, c)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"campaigns": campaigns, "total": total})
}

func (s *Server) getCampaign(w http.ResponseWriter, r *http.Request) {
	row := s.db.QueryRow(r.Context(), campaignSelect+` WHERE c.id = $1 AND c.workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	c, err := scanCampaign(row)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "campaign_not_found", "Campaign not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"campaign": c})
}

type campaignInput struct {
	Name         string `json:"name"`
	Subject      string `json:"subject"`
	PreviewText  string `json:"preview_text"`
	FromDomainID string `json:"from_domain_id"`
	AudienceID   string `json:"audience_id"`
	HTML         string `json:"html"`
	TrackOpens   *bool  `json:"track_opens"`
	TrackClicks  *bool  `json:"track_clicks"`
}

func (s *Server) createCampaign(w http.ResponseWriter, r *http.Request) {
	var req campaignInput
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Subject = strings.TrimSpace(req.Subject)
	req.PreviewText = strings.TrimSpace(req.PreviewText)
	if req.Name == "" || len(req.Name) > 160 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Campaign name must be between 1 and 160 characters")
		return
	}
	if len(req.Subject) > 300 || len(req.PreviewText) > 300 {
		httpx.Error(w, http.StatusBadRequest, "invalid_subject", "Subject and preview text must be 300 characters or fewer")
		return
	}
	if req.FromDomainID != "" {
		if _, err := s.loadDomain(r.Context(), workspaceID(r), req.FromDomainID); err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_domain", "Select a valid sending domain")
			return
		}
	}
	if req.AudienceID != "" {
		var exists bool
		_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM audiences WHERE id = $1 AND workspace_id = $2)`, req.AudienceID, workspaceID(r)).Scan(&exists)
		if !exists {
			httpx.Error(w, http.StatusBadRequest, "invalid_audience", "Select a valid audience")
			return
		}
	}
	trackOpens := true
	if req.TrackOpens != nil {
		trackOpens = *req.TrackOpens
	}
	trackClicks := true
	if req.TrackClicks != nil {
		trackClicks = *req.TrackClicks
	}

	id := uuid.NewString()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO campaigns (id, workspace_id, name, subject, preview_text, from_domain_id, audience_id, html, track_opens, track_clicks)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,NULLIF($7,'')::uuid,$8,$9,$10)
	`, id, workspaceID(r), req.Name, req.Subject, req.PreviewText, req.FromDomainID, req.AudienceID, req.HTML, trackOpens, trackClicks)
	if err != nil {
		s.logger.Error("create campaign", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the campaign")
		return
	}
	c, err := s.getCampaignByID(r, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the campaign")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"campaign": c})
}

func (s *Server) getCampaignByID(r *http.Request, id string) (Campaign, error) {
	return s.getCampaignByIDContext(r.Context(), workspaceID(r), id)
}

func (s *Server) getCampaignByIDContext(ctx context.Context, workspace, id string) (Campaign, error) {
	row := s.db.QueryRow(ctx, campaignSelect+` WHERE c.id = $1 AND c.workspace_id = $2`, id, workspace)
	return scanCampaign(row)
}

type campaignScheduleFailure struct {
	Status  int
	Code    string
	Message string
}

func (s *Server) scheduleCampaign(ctx context.Context, workspace, campaignID string, scheduledAt time.Time) (Campaign, *campaignScheduleFailure) {
	c, err := s.getCampaignByIDContext(ctx, workspace, campaignID)
	if err != nil {
		return Campaign{}, &campaignScheduleFailure{http.StatusNotFound, "campaign_not_found", "Campaign not found"}
	}
	if c.Status != "draft" {
		return Campaign{}, &campaignScheduleFailure{http.StatusConflict, "campaign_locked", "This campaign has already been scheduled or sent"}
	}
	if c.Subject == "" || c.HTML == "" || c.FromDomainID == nil || c.AudienceID == nil {
		return Campaign{}, &campaignScheduleFailure{http.StatusBadRequest, "campaign_incomplete", "Add a subject, sender, audience and email content before sending"}
	}
	d, err := s.loadDomain(ctx, workspace, *c.FromDomainID)
	if err != nil || d.Status != "active" {
		return Campaign{}, &campaignScheduleFailure{http.StatusUnprocessableEntity, "domain_not_active", "The sending domain must pass a delivery test before you can send campaigns"}
	}
	var recipientCount int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM audience_members am
		JOIN contacts c ON c.id = am.contact_id
		WHERE am.audience_id = $1 AND c.unsubscribed = false
	`, *c.AudienceID).Scan(&recipientCount); err != nil {
		return Campaign{}, &campaignScheduleFailure{http.StatusInternalServerError, "internal_error", "Could not count campaign recipients"}
	}
	if recipientCount == 0 {
		return Campaign{}, &campaignScheduleFailure{http.StatusUnprocessableEntity, "empty_audience", "This audience has no subscribed contacts"}
	}

	tag, err := s.db.Exec(ctx, `
		UPDATE campaigns SET status = 'scheduled', scheduled_at = $1, total_recipients = $2, updated_at = now()
		WHERE id = $3 AND workspace_id = $4 AND status = 'draft'
	`, scheduledAt, recipientCount, campaignID, workspace)
	if err != nil {
		return Campaign{}, &campaignScheduleFailure{http.StatusInternalServerError, "internal_error", "Could not schedule the campaign"}
	}
	if tag.RowsAffected() == 0 {
		return Campaign{}, &campaignScheduleFailure{http.StatusConflict, "campaign_locked", "This campaign has already been scheduled or sent"}
	}
	if err := s.queue.EnqueueCampaign(campaignID, scheduledAt); err != nil {
		_, _ = s.db.Exec(ctx, `UPDATE campaigns SET status = 'draft', scheduled_at = NULL WHERE id = $1`, campaignID)
		s.logger.Error("enqueue campaign", "error", err)
		return Campaign{}, &campaignScheduleFailure{http.StatusInternalServerError, "internal_error", "Could not queue the campaign"}
	}
	updated, err := s.getCampaignByIDContext(ctx, workspace, campaignID)
	if err != nil {
		return Campaign{}, &campaignScheduleFailure{http.StatusInternalServerError, "internal_error", "Could not load the campaign"}
	}
	return updated, nil
}

func (s *Server) updateCampaign(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	var existing struct {
		Status string
	}
	if err := s.db.QueryRow(r.Context(), `SELECT status FROM campaigns WHERE id = $1 AND workspace_id = $2`, campaignID, workspaceID(r)).Scan(&existing.Status); err != nil {
		httpx.Error(w, http.StatusNotFound, "campaign_not_found", "Campaign not found")
		return
	}
	if existing.Status != "draft" {
		httpx.Error(w, http.StatusConflict, "campaign_locked", "Only draft campaigns can be edited")
		return
	}
	var req struct {
		Name         *string `json:"name"`
		Subject      *string `json:"subject"`
		PreviewText  *string `json:"preview_text"`
		FromDomainID *string `json:"from_domain_id"`
		AudienceID   *string `json:"audience_id"`
		HTML         *string `json:"html"`
		TrackOpens   *bool   `json:"track_opens"`
		TrackClicks  *bool   `json:"track_clicks"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	set := []string{}
	args := []any{}
	add := func(column string, value any) {
		args = append(args, value)
		set = append(set, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || len(name) > 160 {
			httpx.Error(w, http.StatusBadRequest, "invalid_name", "Campaign name must be between 1 and 160 characters")
			return
		}
		add("name", name)
	}
	if req.Subject != nil {
		add("subject", strings.TrimSpace(*req.Subject))
	}
	if req.PreviewText != nil {
		add("preview_text", strings.TrimSpace(*req.PreviewText))
	}
	if req.FromDomainID != nil {
		if *req.FromDomainID != "" {
			if _, err := s.loadDomain(r.Context(), workspaceID(r), *req.FromDomainID); err != nil {
				httpx.Error(w, http.StatusBadRequest, "invalid_domain", "Select a valid sending domain")
				return
			}
		}
		args = append(args, *req.FromDomainID)
		set = append(set,
			fmt.Sprintf("from_domain_id = NULLIF($%d,'')::uuid", len(args)),
			"from_email = ''", "from_name = ''", "reply_to = ''")
	}
	if req.AudienceID != nil {
		if *req.AudienceID != "" {
			var exists bool
			_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM audiences WHERE id = $1 AND workspace_id = $2)`, *req.AudienceID, workspaceID(r)).Scan(&exists)
			if !exists {
				httpx.Error(w, http.StatusBadRequest, "invalid_audience", "Select a valid audience")
				return
			}
		}
		args = append(args, *req.AudienceID)
		set = append(set, fmt.Sprintf("audience_id = NULLIF($%d,'')::uuid", len(args)))
	}
	if req.HTML != nil {
		add("html", *req.HTML)
	}
	if req.TrackOpens != nil {
		add("track_opens", *req.TrackOpens)
	}
	if req.TrackClicks != nil {
		add("track_clicks", *req.TrackClicks)
	}
	if len(set) == 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "No fields to update")
		return
	}
	set = append(set, "updated_at = now()")
	args = append(args, campaignID, workspaceID(r))
	_, err := s.db.Exec(r.Context(), fmt.Sprintf(
		"UPDATE campaigns SET %s WHERE id = $%d AND workspace_id = $%d",
		strings.Join(set, ", "), len(args)-1, len(args),
	), args...)
	if err != nil {
		s.logger.Error("update campaign", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the campaign")
		return
	}
	c, _ := s.getCampaignByID(r, campaignID)
	httpx.JSON(w, http.StatusOK, map[string]any{"campaign": c})
}

func (s *Server) sendCampaign(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	var req struct {
		ScheduledAt string `json:"scheduled_at"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	scheduledAt := time.Now().UTC()
	if req.ScheduledAt != "" {
		parsed, err := time.Parse(time.RFC3339, req.ScheduledAt)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_schedule", "Scheduled time must be a valid ISO 8601 date")
			return
		}
		scheduledAt = parsed.UTC()
	}

	updated, failure := s.scheduleCampaign(r.Context(), workspaceID(r), campaignID, scheduledAt)
	if failure != nil {
		httpx.Error(w, failure.Status, failure.Code, failure.Message)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"campaign": updated})
}

func (s *Server) cancelCampaign(w http.ResponseWriter, r *http.Request) {
	campaignID := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE campaigns SET status = 'canceled', updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND status = 'scheduled'
	`, campaignID, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not cancel the campaign")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusConflict, "campaign_not_scheduled", "Only scheduled campaigns can be canceled")
		return
	}
	c, _ := s.getCampaignByID(r, campaignID)
	httpx.JSON(w, http.StatusOK, map[string]any{"campaign": c})
}

func (s *Server) deleteCampaign(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `
		DELETE FROM campaigns WHERE id = $1 AND workspace_id = $2 AND status IN ('draft', 'canceled')
	`, chi.URLParam(r, "id"), workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the campaign")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusConflict, "campaign_locked", "Only draft or canceled campaigns can be deleted")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/hauxyz/sendme/server/internal/httpx"
)

type analyticsSeriesPoint struct {
	Date    string `json:"date"`
	Sent    int    `json:"sent"`
	Failed  int    `json:"failed"`
	Opened  int    `json:"opened"`
	Clicked int    `json:"clicked"`
}

type domainAnalytics struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Status   string  `json:"status"`
	Sent     int     `json:"sent"`
	Opened   int     `json:"opened"`
	OpenRate float64 `json:"open_rate"`
}

func (s *Server) analytics(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 7 || days > 90 {
		days = 14
	}
	workspace := workspaceID(r)
	since := time.Now().UTC().AddDate(0, 0, -days+1).Truncate(24 * time.Hour)

	var sent, failed, opened, clicked int
	err := s.db.QueryRow(r.Context(), `
		SELECT
			count(*) FILTER (WHERE status = 'sent'),
			count(*) FILTER (WHERE status = 'failed'),
			count(*) FILTER (WHERE opens > 0),
			count(*) FILTER (WHERE clicks > 0)
		FROM emails WHERE workspace_id = $1 AND created_at >= $2
	`, workspace, since).Scan(&sent, &failed, &opened, &clicked)
	if err != nil {
		s.logger.Error("analytics totals", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load analytics")
		return
	}

	var totalContacts, totalSubscribers, activeCampaigns int
	_ = s.db.QueryRow(r.Context(), `
		SELECT
			(SELECT count(*) FROM contacts WHERE workspace_id = $1),
			(SELECT count(*) FROM contacts WHERE workspace_id = $1 AND unsubscribed = false),
			(SELECT count(*) FROM campaigns WHERE workspace_id = $1 AND status IN ('scheduled','sending'))
	`, workspace).Scan(&totalContacts, &totalSubscribers, &activeCampaigns)

	rows, err := s.db.Query(r.Context(), `
		WITH days AS (
			SELECT generate_series($2::date, CURRENT_DATE, '1 day'::interval)::date AS day
		),
		sent_by_day AS (
			SELECT date_trunc('day', created_at)::date AS day,
				count(*) FILTER (WHERE status = 'sent') AS sent,
				count(*) FILTER (WHERE status = 'failed') AS failed
			FROM emails WHERE workspace_id = $1 AND created_at >= $2
			GROUP BY 1
		),
		opened_by_day AS (
			SELECT date_trunc('day', ev.created_at)::date AS day, count(DISTINCT ev.email_id) AS opened
			FROM email_events ev JOIN emails e ON e.id = ev.email_id
			WHERE e.workspace_id = $1 AND ev.type = 'opened' AND ev.created_at >= $2
			GROUP BY 1
		),
		clicked_by_day AS (
			SELECT date_trunc('day', ev.created_at)::date AS day, count(DISTINCT ev.email_id) AS clicked
			FROM email_events ev JOIN emails e ON e.id = ev.email_id
			WHERE e.workspace_id = $1 AND ev.type = 'clicked' AND ev.created_at >= $2
			GROUP BY 1
		)
		SELECT days.day,
			COALESCE(s.sent, 0), COALESCE(s.failed, 0), COALESCE(o.opened, 0), COALESCE(c.clicked, 0)
		FROM days
		LEFT JOIN sent_by_day s ON s.day = days.day
		LEFT JOIN opened_by_day o ON o.day = days.day
		LEFT JOIN clicked_by_day c ON c.day = days.day
		ORDER BY days.day
	`, workspace, since.Format("2006-01-02"))
	if err != nil {
		s.logger.Error("analytics series", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load analytics")
		return
	}
	series := make([]analyticsSeriesPoint, 0, days)
	for rows.Next() {
		var point analyticsSeriesPoint
		var day time.Time
		if err := rows.Scan(&day, &point.Sent, &point.Failed, &point.Opened, &point.Clicked); err != nil {
			continue
		}
		point.Date = day.Format("2006-01-02")
		series = append(series, point)
	}
	rows.Close()

	domainRows, err := s.db.Query(r.Context(), `
		SELECT d.id, d.name, d.status,
			count(e.id) FILTER (WHERE e.status = 'sent' AND e.created_at >= $2) AS sent,
			count(e.id) FILTER (WHERE e.opens > 0 AND e.created_at >= $2) AS opened
		FROM domains d
		LEFT JOIN emails e ON e.domain_id = d.id
		WHERE d.workspace_id = $1
		GROUP BY d.id
		ORDER BY sent DESC, d.created_at ASC
	`, workspace, since)
	if err != nil {
		s.logger.Error("domain analytics", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load analytics")
		return
	}
	domains := make([]domainAnalytics, 0)
	for domainRows.Next() {
		var d domainAnalytics
		if err := domainRows.Scan(&d.ID, &d.Name, &d.Status, &d.Sent, &d.Opened); err == nil {
			if d.Sent > 0 {
				d.OpenRate = roundPercent(float64(d.Opened) / float64(d.Sent) * 100)
			}
			domains = append(domains, d)
		}
	}
	domainRows.Close()

	recentRows, err := s.db.Query(r.Context(), emailSummarySelect+`
		WHERE e.workspace_id = $1 ORDER BY e.created_at DESC LIMIT 6
	`, workspace)
	if err != nil {
		s.logger.Error("recent emails", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load analytics")
		return
	}
	recentEmails := make([]EmailSummary, 0)
	for recentRows.Next() {
		e, err := scanEmailSummary(recentRows)
		if err == nil {
			recentEmails = append(recentEmails, e)
		}
	}
	recentRows.Close()

	openRate := 0.0
	clickRate := 0.0
	if sent > 0 {
		openRate = roundPercent(float64(opened) / float64(sent) * 100)
		clickRate = roundPercent(float64(clicked) / float64(sent) * 100)
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"days": days,
		"totals": map[string]any{
			"sent":             sent,
			"failed":           failed,
			"opened":           opened,
			"clicked":          clicked,
			"open_rate":        openRate,
			"click_rate":       clickRate,
			"contacts":         totalContacts,
			"subscribers":      totalSubscribers,
			"active_campaigns": activeCampaigns,
		},
		"series":        series,
		"domains":       domains,
		"recent_emails": recentEmails,
		"generated_at":  time.Now().UTC(),
	})
}

func roundPercent(value float64) float64 {
	return float64(int(value*10+0.5)) / 10
}

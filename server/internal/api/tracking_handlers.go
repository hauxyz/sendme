package api

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/hauxyz/sendme/server/internal/httpx"
)

var transparentGIF, _ = base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")

func (s *Server) trackOpen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/gif")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	file := chi.URLParam(r, "file")
	trackingID := strings.TrimSuffix(file, ".gif")
	if trackingID == "" {
		_, _ = w.Write(transparentGIF)
		return
	}

	var emailID, workspace, toEmail string
	var campaign *string
	var opens int
	err := s.db.QueryRow(r.Context(), `
		UPDATE emails
		SET opens = opens + 1,
			first_opened_at = COALESCE(first_opened_at, now()),
			last_opened_at = now(),
			updated_at = now()
		WHERE tracking_id = $1 AND track_opens = true
		RETURNING id, workspace_id, campaign_id, to_email, opens
	`, trackingID).Scan(&emailID, &workspace, &campaign, &toEmail, &opens)
	if err == nil {
		_, _ = s.db.Exec(r.Context(), `
			INSERT INTO email_events (email_id, type, user_agent, ip) VALUES ($1, 'opened', $2, $3)
		`, emailID, truncate(r.UserAgent(), 500), httpx.ClientIP(r))
		if opens == 1 {
			data := map[string]any{
				"email_id": emailID,
				"to":       toEmail,
			}
			if campaign != nil {
				data["campaign_id"] = *campaign
			}
			s.emitEvent(r.Context(), workspace, "email.opened", data)
		}
	}
	_, _ = w.Write(transparentGIF)
}

func (s *Server) trackClick(w http.ResponseWriter, r *http.Request) {
	trackingID := chi.URLParam(r, "id")
	encodedURL := r.URL.Query().Get("url")
	signature := r.URL.Query().Get("sig")
	target, ok := s.tracker.ValidateClick(trackingID, encodedURL, signature)
	if !ok {
		http.Error(w, "Invalid tracking link", http.StatusBadRequest)
		return
	}

	var emailID, workspace string
	var campaign *string
	var clicks int
	var toEmail string
	err := s.db.QueryRow(r.Context(), `
		UPDATE emails
		SET clicks = clicks + 1, updated_at = now()
		WHERE tracking_id = $1 AND track_clicks = true
		RETURNING id, workspace_id, campaign_id, to_email, clicks
	`, trackingID).Scan(&emailID, &workspace, &campaign, &toEmail, &clicks)
	if err == nil {
		_, _ = s.db.Exec(r.Context(), `
			INSERT INTO email_events (email_id, type, url, user_agent, ip) VALUES ($1, 'clicked', $2, $3, $4)
		`, emailID, truncate(target, 2000), truncate(r.UserAgent(), 500), httpx.ClientIP(r))
		if clicks == 1 {
			data := map[string]any{
				"email_id": emailID,
				"to":       toEmail,
				"url":      target,
			}
			if campaign != nil {
				data["campaign_id"] = *campaign
			}
			s.emitEvent(r.Context(), workspace, "email.clicked", data)
		}
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	contactID, ok := s.tracker.ValidateUnsubscribe(token)
	if !ok {
		s.renderUnsubscribePage(w, http.StatusBadRequest, "This unsubscribe link is invalid or has expired.", false)
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE contacts SET unsubscribed = true, updated_at = now() WHERE id = $1
	`, contactID)
	if err != nil {
		s.renderUnsubscribePage(w, http.StatusInternalServerError, "We could not process your request. Please try again later.", false)
		return
	}
	s.renderUnsubscribePage(w, http.StatusOK, "You have been unsubscribed from future marketing emails.", tag.RowsAffected() > 0)
}

func (s *Server) renderUnsubscribePage(w http.ResponseWriter, status int, message string, success bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	w.WriteHeader(status)
	icon := "&#10003;"
	color := "#8b5cf6"
	if !success {
		icon = "!"
		color = "#f97316"
	}
	fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribe — SendMe</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #08080a; color: #f4f4f5; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 24px; }
  .card { width: 100%%; max-width: 440px; background: #111114; border: 1px solid #27272a; border-radius: 20px; padding: 40px; text-align: center; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
  .icon { width: 56px; height: 56px; margin: 0 auto 24px; border-radius: 16px; display: grid; place-items: center; font-size: 26px; font-weight: 700; color: #fff; background: %s; }
  h1 { font-size: 22px; letter-spacing: -.02em; margin: 0 0 12px; }
  p { color: #a1a1aa; line-height: 1.65; font-size: 14px; margin: 0; }
  .brand { margin-top: 32px; padding-top: 24px; border-top: 1px solid #27272a; color: #71717a; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">%s</div>
    <h1>%s</h1>
    <p>%s</p>
    <div class="brand">SendMe</div>
  </div>
</body>
</html>`, color, icon, map[bool]string{true: "Unsubscribed", false: "Something went wrong"}[success], message)
}

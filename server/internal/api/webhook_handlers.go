package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/httpx"
)

var webhookEvents = map[string]bool{
	"email.sent":         true,
	"email.failed":       true,
	"email.opened":       true,
	"email.clicked":      true,
	"contact.created":    true,
	"campaign.completed": true,
}

type Webhook struct {
	ID        string          `json:"id"`
	URL       string          `json:"url"`
	Secret    string          `json:"secret"`
	Events    json.RawMessage `json:"events"`
	Enabled   bool            `json:"enabled"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type WebhookDelivery struct {
	ID           string          `json:"id"`
	WebhookID    string          `json:"webhook_id"`
	Event        string          `json:"event"`
	Payload      json.RawMessage `json:"payload"`
	StatusCode   *int            `json:"status_code"`
	ResponseBody string          `json:"response_body"`
	Error        string          `json:"error"`
	Attempts     int             `json:"attempts"`
	DeliveredAt  *time.Time      `json:"delivered_at"`
	CreatedAt    time.Time       `json:"created_at"`
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, url, secret, events, enabled, created_at, updated_at
		FROM webhooks WHERE workspace_id = $1 ORDER BY created_at DESC
	`, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load webhooks")
		return
	}
	defer rows.Close()
	webhooks := make([]Webhook, 0)
	for rows.Next() {
		var hook Webhook
		if err := rows.Scan(&hook.ID, &hook.URL, &hook.Secret, &hook.Events, &hook.Enabled, &hook.CreatedAt, &hook.UpdatedAt); err == nil {
			webhooks = append(webhooks, hook)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"webhooks": webhooks, "available_events": eventList()})
}

func eventList() []string {
	return []string{"email.sent", "email.failed", "email.opened", "email.clicked", "contact.created", "campaign.completed"}
}

func (s *Server) getWebhook(w http.ResponseWriter, r *http.Request) {
	hook, err := s.loadWebhook(r, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "webhook_not_found", "Webhook not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"webhook": hook})
}

func (s *Server) loadWebhook(r *http.Request, id string) (*Webhook, error) {
	var hook Webhook
	err := s.db.QueryRow(r.Context(), `
		SELECT id, url, secret, events, enabled, created_at, updated_at
		FROM webhooks WHERE id = $1 AND workspace_id = $2
	`, id, workspaceID(r)).Scan(&hook.ID, &hook.URL, &hook.Secret, &hook.Events, &hook.Enabled, &hook.CreatedAt, &hook.UpdatedAt)
	return &hook, err
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL    string   `json:"url"`
		Events []string `json:"events"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if !validWebhookURL(req.URL) {
		httpx.Error(w, http.StatusBadRequest, "invalid_url", "Enter a valid HTTP or HTTPS webhook URL")
		return
	}
	events, err := cleanEvents(req.Events)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_events", err.Error())
		return
	}
	eventsJSON, _ := json.Marshal(events)
	id := uuid.NewString()
	secret := auth.GenerateWebhookSecret()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO webhooks (id, workspace_id, url, secret, events)
		VALUES ($1, $2, $3, $4, $5)
	`, id, workspaceID(r), req.URL, secret, string(eventsJSON))
	if err != nil {
		s.logger.Error("create webhook", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the webhook")
		return
	}
	hook, _ := s.loadWebhook(r, id)
	httpx.JSON(w, http.StatusCreated, map[string]any{"webhook": hook})
}

func (s *Server) updateWebhook(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := s.loadWebhook(r, id); err != nil {
		httpx.Error(w, http.StatusNotFound, "webhook_not_found", "Webhook not found")
		return
	}
	var req struct {
		URL     *string   `json:"url"`
		Events  *[]string `json:"events"`
		Enabled *bool     `json:"enabled"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	set := []string{}
	args := []any{}
	if req.URL != nil {
		value := strings.TrimSpace(*req.URL)
		if !validWebhookURL(value) {
			httpx.Error(w, http.StatusBadRequest, "invalid_url", "Enter a valid HTTP or HTTPS webhook URL")
			return
		}
		args = append(args, value)
		set = append(set, "url = $"+strconv.Itoa(len(args)))
	}
	if req.Events != nil {
		events, err := cleanEvents(*req.Events)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_events", err.Error())
			return
		}
		value, _ := json.Marshal(events)
		args = append(args, string(value))
		set = append(set, "events = $"+strconv.Itoa(len(args)))
	}
	if req.Enabled != nil {
		args = append(args, *req.Enabled)
		set = append(set, "enabled = $"+strconv.Itoa(len(args)))
	}
	if len(set) == 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "No fields to update")
		return
	}
	set = append(set, "updated_at = now()")
	args = append(args, id, workspaceID(r))
	_, err := s.db.Exec(r.Context(), "UPDATE webhooks SET "+strings.Join(set, ", ")+" WHERE id = $"+strconv.Itoa(len(args)-1)+" AND workspace_id = $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the webhook")
		return
	}
	hook, _ := s.loadWebhook(r, id)
	httpx.JSON(w, http.StatusOK, map[string]any{"webhook": hook})
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `DELETE FROM webhooks WHERE id = $1 AND workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the webhook")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "webhook_not_found", "Webhook not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) testWebhook(w http.ResponseWriter, r *http.Request) {
	hook, err := s.loadWebhook(r, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "webhook_not_found", "Webhook not found")
		return
	}
	payload := map[string]any{
		"type":       "webhook.test",
		"created_at": time.Now().UTC(),
		"data": map[string]any{
			"message":    "This is a test event from SendMe.",
			"webhook_id": hook.ID,
		},
	}
	deliveryID, err := s.createWebhookDelivery(r.Context(), hook, "webhook.test", payload)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not queue the test event")
		return
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"ok": true, "delivery_id": deliveryID})
}

func (s *Server) listWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	webhookID := chi.URLParam(r, "id")
	if _, err := s.loadWebhook(r, webhookID); err != nil {
		httpx.Error(w, http.StatusNotFound, "webhook_not_found", "Webhook not found")
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT id, webhook_id, event, payload, status_code, response_body, error, attempts, delivered_at, created_at
		FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 50
	`, webhookID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load webhook deliveries")
		return
	}
	defer rows.Close()
	deliveries := make([]WebhookDelivery, 0)
	for rows.Next() {
		var delivery WebhookDelivery
		if err := rows.Scan(&delivery.ID, &delivery.WebhookID, &delivery.Event, &delivery.Payload, &delivery.StatusCode,
			&delivery.ResponseBody, &delivery.Error, &delivery.Attempts, &delivery.DeliveredAt, &delivery.CreatedAt); err == nil {
			deliveries = append(deliveries, delivery)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"deliveries": deliveries})
}

func (s *Server) emitEvent(ctx context.Context, workspace string, event string, data map[string]any) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := s.db.Query(ctx, `
		SELECT id, url, secret, events FROM webhooks
		WHERE workspace_id = $1 AND enabled = true AND events ? $2
	`, workspace, event)
	if err != nil {
		s.logger.Error("load webhooks for event", "error", err, "event", event)
		return
	}
	type target struct {
		hook Webhook
	}
	targets := []target{}
	for rows.Next() {
		var hook Webhook
		if err := rows.Scan(&hook.ID, &hook.URL, &hook.Secret, &hook.Events); err == nil {
			targets = append(targets, target{hook: hook})
		}
	}
	rows.Close()

	payload := map[string]any{
		"type":       event,
		"created_at": time.Now().UTC(),
		"data":       data,
	}
	for _, item := range targets {
		if _, err := s.createWebhookDelivery(ctx, &item.hook, event, payload); err != nil {
			s.logger.Error("queue webhook delivery", "error", err, "event", event)
		}
	}
}

func (s *Server) createWebhookDelivery(ctx context.Context, hook *Webhook, event string, payload map[string]any) (string, error) {
	body, _ := json.Marshal(payload)
	id := uuid.NewString()
	_, err := s.db.Exec(ctx, `
		INSERT INTO webhook_deliveries (id, webhook_id, event, payload)
		VALUES ($1, $2, $3, $4)
	`, id, hook.ID, event, string(body))
	if err != nil {
		return "", err
	}
	if err := s.queue.EnqueueWebhook(id); err != nil {
		return "", err
	}
	return id, nil
}

func validWebhookURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return false
	}
	return true
}

func cleanEvents(events []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(events))
	for _, event := range events {
		event = strings.TrimSpace(event)
		if !webhookEvents[event] {
			return nil, errInvalidEvent(event)
		}
		if !seen[event] {
			seen[event] = true
			out = append(out, event)
		}
	}
	if len(out) == 0 {
		return nil, errNoEvents
	}
	return out, nil
}

type simpleError string

func (e simpleError) Error() string { return string(e) }

var errNoEvents = simpleError("Select at least one event")

func errInvalidEvent(event string) error {
	return simpleError("Unknown event: " + event)
}

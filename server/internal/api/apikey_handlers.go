package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/httpx"
)

type APIKey struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (s *Server) listAPIKeys(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, name, prefix, last_used_at, created_at
		FROM api_keys WHERE workspace_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load API keys")
		return
	}
	defer rows.Close()
	keys := make([]APIKey, 0)
	for rows.Next() {
		var key APIKey
		if err := rows.Scan(&key.ID, &key.Name, &key.Prefix, &key.LastUsedAt, &key.CreatedAt); err == nil {
			keys = append(keys, key)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"api_keys": keys})
}

func (s *Server) createAPIKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 100 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Key name must be between 1 and 100 characters")
		return
	}
	raw, prefix, hash := auth.GenerateAPIKey()
	id := uuid.NewString()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO api_keys (id, workspace_id, name, prefix, key_hash)
		VALUES ($1, $2, $3, $4, $5)
	`, id, workspaceID(r), req.Name, prefix, hash)
	if err != nil {
		s.logger.Error("create api key", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the API key")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"api_key": APIKey{ID: id, Name: req.Name, Prefix: prefix, CreatedAt: time.Now().UTC()},
		"key":     raw,
	})
}

func (s *Server) deleteAPIKey(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `DELETE FROM api_keys WHERE id = $1 AND workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not revoke the API key")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "api_key_not_found", "API key not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

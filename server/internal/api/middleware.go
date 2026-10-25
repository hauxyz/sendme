package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/httpx"
)

type contextKey string

const (
	ctxUser        contextKey = "user"
	ctxWorkspaceID contextKey = "workspace_id"
	ctxAPIKeyID    contextKey = "api_key_id"
	ctxRequestID   contextKey = "request_id"
)

type sessionUser struct {
	ID            string
	Name          string
	Email         string
	WorkspaceID   string
	WorkspaceName string
}

func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(auth.CookieName)
		if err != nil || cookie.Value == "" {
			httpx.Error(w, http.StatusUnauthorized, "unauthorized", "You must be signed in")
			return
		}
		claims, err := s.tokens.Parse(cookie.Value)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "unauthorized", "Your session has expired")
			return
		}

		var user sessionUser
		err = s.db.QueryRow(r.Context(), `
			SELECT u.id, u.name, u.email, w.id, w.name
			FROM users u
			JOIN workspace_members m ON m.user_id = u.id
			JOIN workspaces w ON w.id = m.workspace_id
			WHERE u.id = $1 AND w.id = $2
		`, claims.UserID, claims.WorkspaceID).Scan(&user.ID, &user.Name, &user.Email, &user.WorkspaceID, &user.WorkspaceName)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "unauthorized", "Your session is no longer valid")
			return
		}

		ctx := context.WithValue(r.Context(), ctxUser, &user)
		ctx = context.WithValue(ctx, ctxWorkspaceID, user.WorkspaceID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) requireAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
			httpx.Error(w, http.StatusUnauthorized, "missing_api_key", "Provide an API key using the Bearer authorization header")
			return
		}
		raw := strings.TrimSpace(header[len("Bearer "):])
		if !strings.HasPrefix(raw, "sm_") {
			httpx.Error(w, http.StatusUnauthorized, "invalid_api_key", "The API key is invalid")
			return
		}
		hash := auth.HashAPIKey(raw)

		var keyID, workspaceID string
		var lastUsed *time.Time
		err := s.db.QueryRow(r.Context(), `
			SELECT id, workspace_id, last_used_at
			FROM api_keys
			WHERE key_hash = $1 AND revoked_at IS NULL
		`, hash).Scan(&keyID, &workspaceID, &lastUsed)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "invalid_api_key", "The API key is invalid or has been revoked")
			return
		}

		if lastUsed == nil || time.Since(*lastUsed) > time.Minute {
			_, _ = s.db.Exec(r.Context(), `UPDATE api_keys SET last_used_at = now() WHERE id = $1`, keyID)
		}

		allowed, _, err := s.queue.Allow(r.Context(), "ratelimit:api:"+keyID, 120, time.Minute)
		if err == nil && !allowed {
			w.Header().Set("Retry-After", "60")
			httpx.Error(w, http.StatusTooManyRequests, "rate_limited", "Too many requests. Please slow down.")
			return
		}

		ctx := context.WithValue(r.Context(), ctxWorkspaceID, workspaceID)
		ctx = context.WithValue(ctx, ctxAPIKeyID, keyID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func workspaceID(r *http.Request) string {
	value, _ := r.Context().Value(ctxWorkspaceID).(string)
	return value
}

func apiKeyID(r *http.Request) string {
	value, _ := r.Context().Value(ctxAPIKeyID).(string)
	return value
}

func currentUser(r *http.Request) *sessionUser {
	value, _ := r.Context().Value(ctxUser).(*sessionUser)
	return value
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", requestID)
		start := time.Now()
		wrapped := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		ctx := context.WithValue(r.Context(), ctxRequestID, requestID)
		next.ServeHTTP(wrapped, r.WithContext(ctx))

		if !strings.HasPrefix(r.URL.Path, "/healthz") {
			s.logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", wrapped.status,
				"duration", time.Since(start).Round(time.Millisecond).String(),
				"request_id", requestID,
			)
		}
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("panic recovered", "error", recovered, "stack", string(debug.Stack()))
				httpx.Error(w, http.StatusInternalServerError, "internal_error", "An unexpected error occurred")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	allowed := make(map[string]bool, len(s.cfg.TrustedOrigins))
	for _, origin := range s.cfg.TrustedOrigins {
		allowed[origin] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !allowed[origin] {
				httpx.Error(w, http.StatusForbidden, "origin_not_allowed", "This origin is not allowed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestError(w http.ResponseWriter, status int, code string, format string, args ...any) {
	httpx.Error(w, status, code, fmt.Sprintf(format, args...))
}

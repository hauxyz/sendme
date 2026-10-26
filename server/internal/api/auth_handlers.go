package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/httpx"
)

type authUser struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type authWorkspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type authResponse struct {
	User      authUser      `json:"user"`
	Workspace authWorkspace `json:"workspace"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string `json:"name"`
		Email         string `json:"email"`
		Password      string `json:"password"`
		WorkspaceName string `json:"workspace_name"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.WorkspaceName = strings.TrimSpace(req.WorkspaceName)

	if req.Name == "" || len(req.Name) > 80 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Name must be between 1 and 80 characters")
		return
	}
	if !validEmail(req.Email) {
		httpx.Error(w, http.StatusBadRequest, "invalid_email", "Enter a valid email address")
		return
	}
	if len(req.Password) < 8 || len(req.Password) > 256 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "Password must be at least 8 characters")
		return
	}
	if req.WorkspaceName == "" {
		req.WorkspaceName = req.Name + "'s workspace"
	}
	if len(req.WorkspaceName) > 80 {
		httpx.Error(w, http.StatusBadRequest, "invalid_workspace", "Workspace name must be 80 characters or fewer")
		return
	}

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		s.logger.Error("hash password", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create your account")
		return
	}

	userID := uuid.NewString()
	workspaceID := uuid.NewString()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create your account")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	if _, err := tx.Exec(r.Context(), `INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)`, userID, req.Name, req.Email, passwordHash); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, http.StatusConflict, "email_taken", "An account with this email already exists")
			return
		}
		s.logger.Error("insert user", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create your account")
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO workspaces (id, name) VALUES ($1, $2)`, workspaceID, req.WorkspaceName); err != nil {
		s.logger.Error("insert workspace", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create your workspace")
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, userID); err != nil {
		s.logger.Error("insert workspace member", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create your workspace")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create your account")
		return
	}

	token, err := s.tokens.Issue(userID, workspaceID, 0)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create a session")
		return
	}
	s.tokens.SetCookie(w, token)
	httpx.JSON(w, http.StatusCreated, authResponse{
		User:      authUser{ID: userID, Name: req.Name, Email: req.Email},
		Workspace: authWorkspace{ID: workspaceID, Name: req.WorkspaceName},
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if !validEmail(req.Email) || req.Password == "" {
		httpx.Error(w, http.StatusUnauthorized, "invalid_credentials", "Incorrect email or password")
		return
	}

	ip := httpx.ClientIP(r)
	ipAllowed, _, _ := s.queue.Allow(r.Context(), "ratelimit:login:ip:"+ip, 20, 15*time.Minute)
	accountAllowed, _, _ := s.queue.Allow(r.Context(), "ratelimit:login:email:"+req.Email, 10, 15*time.Minute)
	if !ipAllowed || !accountAllowed {
		w.Header().Set("Retry-After", "900")
		httpx.Error(w, http.StatusTooManyRequests, "rate_limited", "Too many login attempts. Try again in a few minutes.")
		return
	}

	var userID, name, email, passwordHash, workspaceID, workspaceName string
	var sessionVersion int
	err := s.db.QueryRow(r.Context(), `
		SELECT u.id, u.name, u.email, u.password_hash, w.id, w.name, u.session_version
		FROM users u
		JOIN workspace_members m ON m.user_id = u.id
		JOIN workspaces w ON w.id = m.workspace_id
		WHERE u.email = $1
		ORDER BY m.created_at ASC
		LIMIT 1
	`, req.Email).Scan(&userID, &name, &email, &passwordHash, &workspaceID, &workspaceName, &sessionVersion)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.logger.Error("login lookup", "error", err)
		}
		httpx.Error(w, http.StatusUnauthorized, "invalid_credentials", "Incorrect email or password")
		return
	}
	if !auth.VerifyPassword(passwordHash, req.Password) {
		httpx.Error(w, http.StatusUnauthorized, "invalid_credentials", "Incorrect email or password")
		return
	}

	token, err := s.tokens.Issue(userID, workspaceID, sessionVersion)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create a session")
		return
	}
	s.tokens.SetCookie(w, token)
	httpx.JSON(w, http.StatusOK, authResponse{
		User:      authUser{ID: userID, Name: name, Email: email},
		Workspace: authWorkspace{ID: workspaceID, Name: workspaceName},
	})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.tokens.ClearCookie(w)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	if user == nil {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "You must be signed in")
		return
	}
	httpx.JSON(w, http.StatusOK, authResponse{
		User:      authUser{ID: user.ID, Name: user.Name, Email: user.Email},
		Workspace: authWorkspace{ID: user.WorkspaceID, Name: user.WorkspaceName},
	})
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req struct {
		Name string `json:"name"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 80 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Name must be between 1 and 80 characters")
		return
	}
	_, err := s.db.Exec(r.Context(), `UPDATE users SET name = $1, updated_at = now() WHERE id = $2`, req.Name, user.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update your profile")
		return
	}
	user.Name = req.Name
	httpx.JSON(w, http.StatusOK, map[string]any{"name": req.Name})
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 256 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "New password must be at least 8 characters")
		return
	}
	var currentHash string
	if err := s.db.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id = $1`, user.ID).Scan(&currentHash); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update your password")
		return
	}
	if !auth.VerifyPassword(currentHash, req.CurrentPassword) {
		httpx.Error(w, http.StatusUnauthorized, "invalid_password", "Your current password is incorrect")
		return
	}
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update your password")
		return
	}
	var sessionVersion int
	err = s.db.QueryRow(r.Context(), `
		UPDATE users
		SET password_hash = $1, session_version = session_version + 1, updated_at = now()
		WHERE id = $2
		RETURNING session_version
	`, newHash, user.ID).Scan(&sessionVersion)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update your password")
		return
	}

	// Rotating the version revokes every other session. Re-issue the current
	// session so the user who just changed their password stays signed in.
	token, err := s.tokens.Issue(user.ID, user.WorkspaceID, sessionVersion)
	if err != nil {
		s.logger.Error("issue session after password change", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Password changed, but a new session could not be created")
		return
	}
	s.tokens.SetCookie(w, token)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req struct {
		Name string `json:"name"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 80 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Workspace name must be between 1 and 80 characters")
		return
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2`, req.Name, user.WorkspaceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update your workspace")
		return
	}
	user.WorkspaceName = req.Name
	httpx.JSON(w, http.StatusOK, map[string]string{"name": req.Name})
}

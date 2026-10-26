package api

import (
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

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/httpx"
)

type adminWorkspaceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type adminUser struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Email      string              `json:"email"`
	IsAdmin    bool                `json:"is_admin"`
	CreatedAt  string              `json:"created_at"`
	Workspaces []adminWorkspaceRef `json:"workspaces"`
}

type adminWorkspaceOwner struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type adminWorkspace struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	CreatedAt   string               `json:"created_at"`
	Owner       *adminWorkspaceOwner `json:"owner"`
	MemberCount int                  `json:"member_count"`
	DomainCount int                  `json:"domain_count"`
	EmailCount  int                  `json:"email_count"`
}

type adminMember struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	IsAdmin   bool   `json:"is_admin"`
	CreatedAt string `json:"created_at"`
}

func adminPagination(r *http.Request) (int, int) {
	page, limit := 1, 50
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			page = parsed
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}
	return page, limit
}

func adminTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func (s *Server) adminOverview(w http.ResponseWriter, r *http.Request) {
	var users, workspaces, domains, emails int
	err := s.db.QueryRow(r.Context(), `
		SELECT
			(SELECT count(*) FROM users),
			(SELECT count(*) FROM workspaces),
			(SELECT count(*) FROM domains),
			(SELECT count(*) FROM emails)
	`).Scan(&users, &workspaces, &domains, &emails)
	if err != nil {
		s.logger.Error("admin overview", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the platform overview")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int{
		"users": users, "workspaces": workspaces, "domains": domains, "emails": emails,
	})
}

func (s *Server) adminListUsers(w http.ResponseWriter, r *http.Request) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	pattern := "%" + search + "%"
	page, limit := adminPagination(r)

	var total int
	if err := s.db.QueryRow(r.Context(), `
		SELECT count(*) FROM users u
		WHERE ($1 = '' OR u.name ILIKE $2 OR u.email::text ILIKE $2)
	`, search, pattern).Scan(&total); err != nil {
		s.logger.Error("count admin users", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load users")
		return
	}

	rows, err := s.db.Query(r.Context(), `
		SELECT u.id, u.name, u.email, u.is_admin, u.created_at,
			COALESCE((
				SELECT json_agg(json_build_object('id', w.id, 'name', w.name, 'role', m.role) ORDER BY w.name)
				FROM workspace_members m
				JOIN workspaces w ON w.id = m.workspace_id
				WHERE m.user_id = u.id
			), '[]'::json)
		FROM users u
		WHERE ($1 = '' OR u.name ILIKE $2 OR u.email::text ILIKE $2)
		ORDER BY u.created_at DESC
		LIMIT $3 OFFSET $4
	`, search, pattern, limit, (page-1)*limit)
	if err != nil {
		s.logger.Error("list admin users", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load users")
		return
	}
	defer rows.Close()

	users := make([]adminUser, 0)
	for rows.Next() {
		var user adminUser
		var createdAt time.Time
		var workspaces []byte
		if err := rows.Scan(&user.ID, &user.Name, &user.Email, &user.IsAdmin, &createdAt, &workspaces); err != nil {
			s.logger.Error("scan admin user", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load users")
			return
		}
		user.CreatedAt = adminTime(createdAt)
		user.Workspaces = []adminWorkspaceRef{}
		if len(workspaces) > 0 {
			_ = json.Unmarshal(workspaces, &user.Workspaces)
		}
		users = append(users, user)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"users": users, "total": total})
}

func (s *Server) adminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string `json:"name"`
		Email         string `json:"email"`
		Password      string `json:"password"`
		IsAdmin       bool   `json:"is_admin"`
		WorkspaceID   string `json:"workspace_id"`
		WorkspaceName string `json:"workspace_name"`
		Role          string `json:"role"`
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
		httpx.Error(w, http.StatusBadRequest, "weak_password", "Password must be between 8 and 256 characters")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role != "owner" && req.Role != "member" {
		httpx.Error(w, http.StatusBadRequest, "invalid_role", "Role must be owner or member")
		return
	}
	if req.WorkspaceID == "" && req.WorkspaceName != "" && len(req.WorkspaceName) > 80 {
		httpx.Error(w, http.StatusBadRequest, "invalid_workspace", "Workspace name must be 80 characters or fewer")
		return
	}

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the user")
		return
	}

	userID := uuid.NewString()
	workspaceID := strings.TrimSpace(req.WorkspaceID)
	role := req.Role
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the user")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	_, err = tx.Exec(r.Context(), `
		INSERT INTO users (id, name, email, password_hash, is_admin)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, req.Name, req.Email, passwordHash, req.IsAdmin)
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "email_taken", "An account with this email already exists")
			return
		}
		s.logger.Error("admin create user", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the user")
		return
	}

	if workspaceID == "" {
		workspaceName := req.WorkspaceName
		if workspaceName == "" {
			workspaceName = req.Name + "'s workspace"
		}
		workspaceID = uuid.NewString()
		if _, err := tx.Exec(r.Context(), `INSERT INTO workspaces (id, name) VALUES ($1, $2)`, workspaceID, workspaceName); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the workspace")
			return
		}
		role = "owner"
	} else {
		var exists bool
		if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)`, workspaceID).Scan(&exists); err != nil || !exists {
			httpx.Error(w, http.StatusBadRequest, "invalid_workspace", "The selected workspace no longer exists")
			return
		}
	}

	if _, err := tx.Exec(r.Context(), `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
	`, workspaceID, userID, role); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the user to the workspace")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the user")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"ok": true, "id": userID, "workspace_id": workspaceID})
}

func (s *Server) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	current := currentUser(r)
	var req struct {
		Name    *string `json:"name"`
		Email   *string `json:"email"`
		IsAdmin *bool   `json:"is_admin"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.IsAdmin != nil && !*req.IsAdmin {
		if current != nil && current.ID == userID {
			httpx.Error(w, http.StatusBadRequest, "invalid_request", "You cannot remove your own administrator access")
			return
		}
		var isAdmin bool
		var adminCount int
		if err := s.db.QueryRow(r.Context(), `SELECT is_admin FROM users WHERE id = $1`, userID).Scan(&isAdmin); err != nil {
			httpx.Error(w, http.StatusNotFound, "not_found", "User not found")
			return
		}
		_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM users WHERE is_admin = true`).Scan(&adminCount)
		if isAdmin && adminCount <= 1 {
			httpx.Error(w, http.StatusConflict, "last_admin", "At least one platform administrator is required")
			return
		}
	}

	set := []string{}
	args := []any{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || len(name) > 80 {
			httpx.Error(w, http.StatusBadRequest, "invalid_name", "Name must be between 1 and 80 characters")
			return
		}
		args = append(args, name)
		set = append(set, fmt.Sprintf("name = $%d", len(args)))
	}
	if req.Email != nil {
		email := strings.ToLower(strings.TrimSpace(*req.Email))
		if !validEmail(email) {
			httpx.Error(w, http.StatusBadRequest, "invalid_email", "Enter a valid email address")
			return
		}
		args = append(args, email)
		set = append(set, fmt.Sprintf("email = $%d", len(args)))
	}
	if req.IsAdmin != nil {
		args = append(args, *req.IsAdmin)
		set = append(set, fmt.Sprintf("is_admin = $%d", len(args)))
	}
	if len(set) == 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "No fields to update")
		return
	}
	set = append(set, "updated_at = now()")
	args = append(args, userID)
	tag, err := s.db.Exec(r.Context(), fmt.Sprintf("UPDATE users SET %s WHERE id = $%d", strings.Join(set, ", "), len(args)), args...)
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "email_taken", "An account with this email already exists")
			return
		}
		s.logger.Error("admin update user", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the user")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) adminResetUserPassword(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var req struct {
		Password string `json:"password"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.Password) < 8 || len(req.Password) > 256 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "Password must be between 8 and 256 characters")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the password")
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE users SET password_hash = $1, session_version = session_version + 1, updated_at = now()
		WHERE id = $2
	`, hash, userID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the password")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	current := currentUser(r)
	if current != nil && current.ID == userID {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "You cannot delete your own account")
		return
	}
	var soleOwned int
	if err := s.db.QueryRow(r.Context(), `
		SELECT count(*) FROM workspace_members m
		WHERE m.user_id = $1 AND m.role = 'owner'
		AND (SELECT count(*) FROM workspace_members o WHERE o.workspace_id = m.workspace_id AND o.role = 'owner') = 1
	`, userID).Scan(&soleOwned); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the user")
		return
	}
	if soleOwned > 0 {
		httpx.Error(w, http.StatusConflict, "owns_workspace", "Transfer ownership of this user's workspaces before deleting the account")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the user")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) adminListWorkspaces(w http.ResponseWriter, r *http.Request) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	pattern := "%" + search + "%"
	page, limit := adminPagination(r)

	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM workspaces w WHERE ($1 = '' OR w.name ILIKE $2)`, search, pattern).Scan(&total); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load workspaces")
		return
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT w.id, w.name, w.created_at,
			COALESCE((
				SELECT json_build_object('id', u.id, 'name', u.name, 'email', u.email)
				FROM workspace_members m JOIN users u ON u.id = m.user_id
				WHERE m.workspace_id = w.id AND m.role = 'owner'
				ORDER BY m.created_at ASC LIMIT 1
			), 'null'::json),
			(SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id),
			(SELECT count(*) FROM domains d WHERE d.workspace_id = w.id),
			(SELECT count(*) FROM emails e WHERE e.workspace_id = w.id)
		FROM workspaces w
		WHERE ($1 = '' OR w.name ILIKE $2)
		ORDER BY w.created_at DESC
		LIMIT $3 OFFSET $4
	`, search, pattern, limit, (page-1)*limit)
	if err != nil {
		s.logger.Error("list admin workspaces", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load workspaces")
		return
	}
	defer rows.Close()

	workspaces := make([]adminWorkspace, 0)
	for rows.Next() {
		var workspace adminWorkspace
		var createdAt time.Time
		var owner []byte
		if err := rows.Scan(&workspace.ID, &workspace.Name, &createdAt, &owner, &workspace.MemberCount, &workspace.DomainCount, &workspace.EmailCount); err != nil {
			s.logger.Error("scan admin workspace", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load workspaces")
			return
		}
		workspace.CreatedAt = adminTime(createdAt)
		if len(owner) > 0 {
			_ = json.Unmarshal(owner, &workspace.Owner)
		}
		workspaces = append(workspaces, workspace)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"workspaces": workspaces, "total": total})
}

func (s *Server) adminCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		OwnerUserID string `json:"owner_user_id"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 80 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Workspace name must be between 1 and 80 characters")
		return
	}
	var ownerExists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, req.OwnerUserID).Scan(&ownerExists); err != nil || !ownerExists {
		httpx.Error(w, http.StatusBadRequest, "invalid_owner", "Select an existing user as the workspace owner")
		return
	}
	workspaceID := uuid.NewString()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the workspace")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `INSERT INTO workspaces (id, name) VALUES ($1, $2)`, workspaceID, req.Name); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the workspace")
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, req.OwnerUserID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the workspace owner")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the workspace")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"ok": true, "id": workspaceID})
}

func (s *Server) adminUpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
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
	tag, err := s.db.Exec(r.Context(), `UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2`, req.Name, workspaceID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the workspace")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "Workspace not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) adminDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == workspaceID(r) {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "You cannot delete the workspace you are currently signed into")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM workspaces WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the workspace")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "Workspace not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) adminListMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	rows, err := s.db.Query(r.Context(), `
		SELECT u.id, u.name, u.email, m.role, u.is_admin, m.created_at
		FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1
		ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, u.name ASC
	`, workspaceID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load workspace members")
		return
	}
	defer rows.Close()
	members := make([]adminMember, 0)
	for rows.Next() {
		var member adminMember
		var createdAt time.Time
		if err := rows.Scan(&member.ID, &member.Name, &member.Email, &member.Role, &member.IsAdmin, &createdAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load workspace members")
			return
		}
		member.CreatedAt = adminTime(createdAt)
		members = append(members, member)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"members": members})
}

func (s *Server) adminAddMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	var workspaceExists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)`, workspaceID).Scan(&workspaceExists); err != nil || !workspaceExists {
		httpx.Error(w, http.StatusNotFound, "not_found", "Workspace not found")
		return
	}
	var req struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role != "owner" && req.Role != "member" {
		httpx.Error(w, http.StatusBadRequest, "invalid_role", "Role must be owner or member")
		return
	}

	var userID string
	var err error
	if strings.TrimSpace(req.UserID) != "" {
		err = s.db.QueryRow(r.Context(), `SELECT id FROM users WHERE id = $1`, req.UserID).Scan(&userID)
	} else if validEmail(strings.TrimSpace(req.Email)) {
		err = s.db.QueryRow(r.Context(), `SELECT id FROM users WHERE email = $1`, strings.ToLower(strings.TrimSpace(req.Email))).Scan(&userID)
	} else {
		httpx.Error(w, http.StatusBadRequest, "invalid_user", "Select a user or enter their email address")
		return
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "User not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the member")
		return
	}

	var existingRole string
	switch err := s.db.QueryRow(r.Context(), `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID).Scan(&existingRole); {
	case err == nil && existingRole == "owner" && req.Role == "member":
		var owners int
		if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, workspaceID).Scan(&owners); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the member")
			return
		}
		if owners <= 1 {
			httpx.Error(w, http.StatusConflict, "last_owner", "A workspace must have at least one owner")
			return
		}
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the member")
		return
	}

	_, err = s.db.Exec(r.Context(), `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, workspaceID, userID, req.Role)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not add the member")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": userID})
}

func (s *Server) adminRemoveMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "userId")
	current := currentUser(r)
	if current != nil && current.ID == userID && current.WorkspaceID == workspaceID {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "You cannot remove yourself from your current workspace")
		return
	}
	var role string
	if err := s.db.QueryRow(r.Context(), `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID).Scan(&role); err != nil {
		httpx.Error(w, http.StatusNotFound, "not_found", "Workspace member not found")
		return
	}
	if role == "owner" {
		var owners int
		_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, workspaceID).Scan(&owners)
		if owners <= 1 {
			httpx.Error(w, http.StatusConflict, "last_owner", "A workspace must have at least one owner")
			return
		}
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not remove the member")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

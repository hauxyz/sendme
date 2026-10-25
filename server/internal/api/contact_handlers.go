package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hauxyz/sendme/server/internal/httpx"
)

type AudienceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Contact struct {
	ID           string          `json:"id"`
	Email        string          `json:"email"`
	FirstName    string          `json:"first_name"`
	LastName     string          `json:"last_name"`
	Unsubscribed bool            `json:"unsubscribed"`
	Metadata     json.RawMessage `json:"metadata"`
	Audiences    []AudienceRef   `json:"audiences"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type Audience struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	MemberCount     int       `json:"member_count"`
	SubscribedCount int       `json:"subscribed_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

const contactSelect = `
	SELECT c.id, c.email, c.first_name, c.last_name, c.unsubscribed, c.metadata, c.created_at, c.updated_at,
		COALESCE((
			SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) ORDER BY a.name)
			FROM audience_members am
			JOIN audiences a ON a.id = am.audience_id
			WHERE am.contact_id = c.id
		), '[]'::jsonb) AS audiences
	FROM contacts c
`

func (s *Server) listContacts(w http.ResponseWriter, r *http.Request) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	audienceID := strings.TrimSpace(r.URL.Query().Get("audience_id"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	limit := httpx.QueryLimit(r, 50, 200)
	offset := httpx.QueryOffset(r)

	where := []string{"c.workspace_id = $1"}
	args := []any{workspaceID(r)}
	if search != "" {
		args = append(args, "%"+search+"%")
		n := len(args)
		where = append(where, fmt.Sprintf("(c.email::text ILIKE $%d OR c.first_name ILIKE $%d OR c.last_name ILIKE $%d)", n, n, n))
	}
	if audienceID != "" {
		args = append(args, audienceID)
		where = append(where, fmt.Sprintf("EXISTS (SELECT 1 FROM audience_members am WHERE am.contact_id = c.id AND am.audience_id = $%d)", len(args)))
	}
	if status == "subscribed" {
		where = append(where, "c.unsubscribed = false")
	} else if status == "unsubscribed" {
		where = append(where, "c.unsubscribed = true")
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	countSQL := `SELECT count(*) FROM contacts c` + whereSQL
	if err := s.db.QueryRow(r.Context(), countSQL, args...).Scan(&total); err != nil {
		s.logger.Error("count contacts", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load contacts")
		return
	}

	args = append(args, limit, offset)
	query := contactSelect + whereSQL + fmt.Sprintf(" ORDER BY c.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		s.logger.Error("list contacts", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load contacts")
		return
	}
	defer rows.Close()

	contacts := make([]Contact, 0)
	for rows.Next() {
		contact, err := scanContact(rows)
		if err != nil {
			s.logger.Error("scan contact", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load contacts")
			return
		}
		contacts = append(contacts, contact)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"contacts": contacts, "total": total})
}

func scanContact(row pgx.Row) (Contact, error) {
	var contact Contact
	var audiencesJSON []byte
	err := row.Scan(&contact.ID, &contact.Email, &contact.FirstName, &contact.LastName, &contact.Unsubscribed,
		&contact.Metadata, &contact.CreatedAt, &contact.UpdatedAt, &audiencesJSON)
	if err != nil {
		return contact, err
	}
	contact.Audiences = []AudienceRef{}
	_ = json.Unmarshal(audiencesJSON, &contact.Audiences)
	if len(contact.Metadata) == 0 {
		contact.Metadata = json.RawMessage(`{}`)
	}
	return contact, nil
}

func (s *Server) getContact(w http.ResponseWriter, r *http.Request) {
	row := s.db.QueryRow(r.Context(), contactSelect+` WHERE c.id = $1 AND c.workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	contact, err := scanContact(row)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "contact_not_found", "Contact not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"contact": contact})
}

func (s *Server) createContact(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string          `json:"email"`
		FirstName   string          `json:"first_name"`
		LastName    string          `json:"last_name"`
		Metadata    json.RawMessage `json:"metadata"`
		AudienceIDs []string        `json:"audience_ids"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	if !validEmail(req.Email) {
		httpx.Error(w, http.StatusBadRequest, "invalid_email", "Enter a valid email address")
		return
	}
	if len(req.FirstName) > 100 || len(req.LastName) > 100 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Names must be 100 characters or fewer")
		return
	}
	if len(req.Metadata) == 0 || string(req.Metadata) == "null" {
		req.Metadata = json.RawMessage(`{}`)
	}
	if !json.Valid(req.Metadata) {
		httpx.Error(w, http.StatusBadRequest, "invalid_metadata", "Metadata must be valid JSON")
		return
	}

	id := uuid.NewString()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the contact")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	_, err = tx.Exec(r.Context(), `
		INSERT INTO contacts (id, workspace_id, email, first_name, last_name, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, workspaceID(r), req.Email, req.FirstName, req.LastName, string(req.Metadata))
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "contact_exists", "A contact with this email already exists")
			return
		}
		s.logger.Error("insert contact", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the contact")
		return
	}
	for _, audienceID := range uniqueStrings(req.AudienceIDs) {
		_, _ = tx.Exec(r.Context(), `
			INSERT INTO audience_members (audience_id, contact_id)
			SELECT a.id, $1 FROM audiences a WHERE a.id = $2 AND a.workspace_id = $3
			ON CONFLICT DO NOTHING
		`, id, audienceID, workspaceID(r))
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the contact")
		return
	}

	row := s.db.QueryRow(r.Context(), contactSelect+` WHERE c.id = $1 AND c.workspace_id = $2`, id, workspaceID(r))
	contact, err := scanContact(row)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the contact")
		return
	}
	s.emitEvent(r.Context(), workspaceID(r), "contact.created", map[string]any{
		"contact": map[string]any{"id": contact.ID, "email": contact.Email, "first_name": contact.FirstName, "last_name": contact.LastName},
	})
	httpx.JSON(w, http.StatusCreated, map[string]any{"contact": contact})
}

func (s *Server) updateContact(w http.ResponseWriter, r *http.Request) {
	contactID := chi.URLParam(r, "id")
	var req struct {
		Email        *string          `json:"email"`
		FirstName    *string          `json:"first_name"`
		LastName     *string          `json:"last_name"`
		Unsubscribed *bool            `json:"unsubscribed"`
		Metadata     *json.RawMessage `json:"metadata"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	setSQL := []string{}
	args := []any{}
	add := func(column string, value any) {
		args = append(args, value)
		setSQL = append(setSQL, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	if req.Email != nil {
		email := strings.ToLower(strings.TrimSpace(*req.Email))
		if !validEmail(email) {
			httpx.Error(w, http.StatusBadRequest, "invalid_email", "Enter a valid email address")
			return
		}
		add("email", email)
	}
	if req.FirstName != nil {
		add("first_name", strings.TrimSpace(*req.FirstName))
	}
	if req.LastName != nil {
		add("last_name", strings.TrimSpace(*req.LastName))
	}
	if req.Unsubscribed != nil {
		add("unsubscribed", *req.Unsubscribed)
	}
	if req.Metadata != nil {
		if !json.Valid(*req.Metadata) {
			httpx.Error(w, http.StatusBadRequest, "invalid_metadata", "Metadata must be valid JSON")
			return
		}
		add("metadata", string(*req.Metadata))
	}
	if len(setSQL) == 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "No fields to update")
		return
	}
	setSQL = append(setSQL, "updated_at = now()")
	args = append(args, contactID, workspaceID(r))
	tag, err := s.db.Exec(r.Context(), fmt.Sprintf(
		"UPDATE contacts SET %s WHERE id = $%d AND workspace_id = $%d",
		strings.Join(setSQL, ", "), len(args)-1, len(args),
	), args...)
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "contact_exists", "A contact with this email already exists")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the contact")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "contact_not_found", "Contact not found")
		return
	}
	row := s.db.QueryRow(r.Context(), contactSelect+` WHERE c.id = $1 AND c.workspace_id = $2`, contactID, workspaceID(r))
	contact, err := scanContact(row)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the contact")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"contact": contact})
}

func (s *Server) deleteContact(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `DELETE FROM contacts WHERE id = $1 AND workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the contact")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "contact_not_found", "Contact not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) importContacts(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contacts []struct {
			Email     string `json:"email"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
		} `json:"contacts"`
		AudienceID string `json:"audience_id"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.Contacts) == 0 {
		httpx.Error(w, http.StatusBadRequest, "empty_import", "Add at least one contact to import")
		return
	}
	if len(req.Contacts) > 5000 {
		httpx.Error(w, http.StatusBadRequest, "import_too_large", "You can import up to 5,000 contacts at a time")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not import contacts")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	imported := 0
	skipped := 0
	invalid := 0
	for _, item := range req.Contacts {
		email := strings.ToLower(strings.TrimSpace(item.Email))
		if !validEmail(email) {
			invalid++
			continue
		}
		var id string
		err := tx.QueryRow(r.Context(), `
			INSERT INTO contacts (id, workspace_id, email, first_name, last_name)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (workspace_id, email) DO NOTHING
			RETURNING id
		`, uuid.NewString(), workspaceID(r), email, strings.TrimSpace(item.FirstName), strings.TrimSpace(item.LastName)).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			if err := tx.QueryRow(r.Context(), `
				SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2
			`, workspaceID(r), email).Scan(&id); err != nil {
				s.logger.Error("load existing imported contact", "error", err)
				httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not import contacts")
				return
			}
			skipped++
		} else if err != nil {
			s.logger.Error("import contact", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not import contacts")
			return
		} else {
			imported++
		}
		if req.AudienceID != "" {
			_, _ = tx.Exec(r.Context(), `
				INSERT INTO audience_members (audience_id, contact_id)
				SELECT a.id, $1 FROM audiences a WHERE a.id = $2 AND a.workspace_id = $3
				ON CONFLICT DO NOTHING
			`, id, req.AudienceID, workspaceID(r))
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not import contacts")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"imported": imported, "skipped": skipped, "invalid": invalid})
}

func (s *Server) listAudiences(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT a.id, a.name, a.description, a.created_at, a.updated_at,
			(SELECT count(*) FROM audience_members am WHERE am.audience_id = a.id) AS member_count,
			(SELECT count(*) FROM audience_members am JOIN contacts c ON c.id = am.contact_id
			 WHERE am.audience_id = a.id AND c.unsubscribed = false) AS subscribed_count
		FROM audiences a
		WHERE a.workspace_id = $1
		ORDER BY a.created_at DESC
	`, workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load audiences")
		return
	}
	defer rows.Close()
	audiences := make([]Audience, 0)
	for rows.Next() {
		var a Audience
		if err := rows.Scan(&a.ID, &a.Name, &a.Description, &a.CreatedAt, &a.UpdatedAt, &a.MemberCount, &a.SubscribedCount); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load audiences")
			return
		}
		audiences = append(audiences, a)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"audiences": audiences})
}

func (s *Server) getAudience(w http.ResponseWriter, r *http.Request) {
	a, err := s.loadAudience(r, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "audience_not_found", "Audience not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"audience": a})
}

func (s *Server) loadAudience(r *http.Request, audienceID string) (*Audience, error) {
	var a Audience
	err := s.db.QueryRow(r.Context(), `
		SELECT a.id, a.name, a.description, a.created_at, a.updated_at,
			(SELECT count(*) FROM audience_members am WHERE am.audience_id = a.id) AS member_count,
			(SELECT count(*) FROM audience_members am JOIN contacts c ON c.id = am.contact_id
			 WHERE am.audience_id = a.id AND c.unsubscribed = false) AS subscribed_count
		FROM audiences a WHERE a.id = $1 AND a.workspace_id = $2
	`, audienceID, workspaceID(r)).Scan(&a.ID, &a.Name, &a.Description, &a.CreatedAt, &a.UpdatedAt, &a.MemberCount, &a.SubscribedCount)
	return &a, err
}

func (s *Server) createAudience(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	if req.Name == "" || len(req.Name) > 120 {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Audience name must be between 1 and 120 characters")
		return
	}
	if len(req.Description) > 500 {
		httpx.Error(w, http.StatusBadRequest, "invalid_description", "Description must be 500 characters or fewer")
		return
	}
	id := uuid.NewString()
	_, err := s.db.Exec(r.Context(), `INSERT INTO audiences (id, workspace_id, name, description) VALUES ($1, $2, $3, $4)`, id, workspaceID(r), req.Name, req.Description)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the audience")
		return
	}
	a, _ := s.loadAudience(r, id)
	httpx.JSON(w, http.StatusCreated, map[string]any{"audience": a})
}

func (s *Server) updateAudience(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	set := []string{}
	args := []any{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || len(name) > 120 {
			httpx.Error(w, http.StatusBadRequest, "invalid_name", "Audience name must be between 1 and 120 characters")
			return
		}
		args = append(args, name)
		set = append(set, fmt.Sprintf("name = $%d", len(args)))
	}
	if req.Description != nil {
		args = append(args, strings.TrimSpace(*req.Description))
		set = append(set, fmt.Sprintf("description = $%d", len(args)))
	}
	if len(set) == 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "No fields to update")
		return
	}
	set = append(set, "updated_at = now()")
	args = append(args, chi.URLParam(r, "id"), workspaceID(r))
	tag, err := s.db.Exec(r.Context(), fmt.Sprintf(
		"UPDATE audiences SET %s WHERE id = $%d AND workspace_id = $%d",
		strings.Join(set, ", "), len(args)-1, len(args),
	), args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the audience")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "audience_not_found", "Audience not found")
		return
	}
	a, _ := s.loadAudience(r, chi.URLParam(r, "id"))
	httpx.JSON(w, http.StatusOK, map[string]any{"audience": a})
}

func (s *Server) deleteAudience(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `DELETE FROM audiences WHERE id = $1 AND workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the audience")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "audience_not_found", "Audience not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) addAudienceContacts(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ContactIDs []string `json:"contact_ids"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.ContactIDs) == 0 {
		httpx.Error(w, http.StatusBadRequest, "empty_selection", "Select at least one contact")
		return
	}
	audienceID := chi.URLParam(r, "id")
	if _, err := s.loadAudience(r, audienceID); err != nil {
		httpx.Error(w, http.StatusNotFound, "audience_not_found", "Audience not found")
		return
	}

	added := 0
	for _, contactID := range uniqueStrings(req.ContactIDs) {
		tag, err := s.db.Exec(r.Context(), `
			INSERT INTO audience_members (audience_id, contact_id)
			SELECT $1, c.id FROM contacts c WHERE c.id = $2 AND c.workspace_id = $3
			ON CONFLICT DO NOTHING
		`, audienceID, contactID, workspaceID(r))
		if err == nil {
			added += int(tag.RowsAffected())
		}
	}
	a, _ := s.loadAudience(r, audienceID)
	httpx.JSON(w, http.StatusOK, map[string]any{"added": added, "audience": a})
}

func (s *Server) removeAudienceContact(w http.ResponseWriter, r *http.Request) {
	_, err := s.db.Exec(r.Context(), `
		DELETE FROM audience_members am
		USING audiences a
		WHERE am.audience_id = a.id AND a.workspace_id = $1
			AND am.audience_id = $2 AND am.contact_id = $3
	`, workspaceID(r), chi.URLParam(r, "id"), chi.URLParam(r, "contactID"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not remove the contact")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

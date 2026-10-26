package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/validate"
)

var (
	ErrEmailTaken   = errors.New("an account with this email already exists")
	ErrUserNotFound = errors.New("no account found with that email")
)

// Account describes a user and the workspace they were created in.
type Account struct {
	UserID        string
	Name          string
	Email         string
	WorkspaceID   string
	WorkspaceName string
}

type CreateOwnerInput struct {
	Name          string
	Email         string
	Password      string
	WorkspaceName string
}

type Service struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// CreateOwner creates a user, a workspace, and an owner membership in one
// transaction. The new account has full access to the workspace dashboard.
func (s *Service) CreateOwner(ctx context.Context, in CreateOwnerInput) (Account, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Email = normalizeEmail(in.Email)
	in.WorkspaceName = strings.TrimSpace(in.WorkspaceName)

	if in.Name == "" || len(in.Name) > 80 {
		return Account{}, errors.New("name must be between 1 and 80 characters")
	}
	if !validate.Email(in.Email) {
		return Account{}, errors.New("enter a valid email address")
	}
	if err := validatePassword(in.Password); err != nil {
		return Account{}, err
	}
	if in.WorkspaceName == "" {
		in.WorkspaceName = in.Name + "'s workspace"
	}
	if len(in.WorkspaceName) > 80 {
		return Account{}, errors.New("workspace name must be 80 characters or fewer")
	}

	passwordHash, err := auth.HashPassword(in.Password)
	if err != nil {
		return Account{}, fmt.Errorf("hash password: %w", err)
	}

	account := Account{
		UserID:        uuid.NewString(),
		Name:          in.Name,
		Email:         in.Email,
		WorkspaceID:   uuid.NewString(),
		WorkspaceName: in.WorkspaceName,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Account{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, name, email, password_hash)
		VALUES ($1, $2, $3, $4)
	`, account.UserID, account.Name, account.Email, passwordHash)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Account{}, ErrEmailTaken
		}
		return Account{}, fmt.Errorf("insert user: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO workspaces (id, name) VALUES ($1, $2)
	`, account.WorkspaceID, account.WorkspaceName); err != nil {
		return Account{}, fmt.Errorf("insert workspace: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, account.WorkspaceID, account.UserID); err != nil {
		return Account{}, fmt.Errorf("insert workspace member: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Account{}, fmt.Errorf("commit transaction: %w", err)
	}
	return account, nil
}

// ResetPassword replaces a user's password and increments their session
// version, which revokes all existing signed-in sessions.
func (s *Service) ResetPassword(ctx context.Context, email, password string) (Account, error) {
	email = normalizeEmail(email)
	if !validate.Email(email) {
		return Account{}, errors.New("enter a valid email address")
	}
	if err := validatePassword(password); err != nil {
		return Account{}, err
	}

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return Account{}, fmt.Errorf("hash password: %w", err)
	}

	account := Account{Email: email}
	err = s.db.QueryRow(ctx, `
		UPDATE users
		SET password_hash = $1,
		    session_version = session_version + 1,
		    updated_at = now()
		WHERE email = $2
		RETURNING id, name
	`, passwordHash, email).Scan(&account.UserID, &account.Name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Account{}, ErrUserNotFound
		}
		return Account{}, fmt.Errorf("update password: %w", err)
	}
	return account, nil
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validatePassword(password string) error {
	if len(password) < 8 || len(password) > 256 {
		return errors.New("password must be between 8 and 256 characters")
	}
	return nil
}

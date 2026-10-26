package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/hauxyz/sendme/server/internal/admin"
	"github.com/hauxyz/sendme/server/internal/config"
	"github.com/hauxyz/sendme/server/internal/database"
)

const usage = `SendMe admin CLI

Usage:
  admin-cli create-admin --email EMAIL [--name NAME] [--workspace NAME]
  admin-cli reset-password --email EMAIL
  admin-cli help

Commands:
  create-admin    Create a workspace owner (admin) account.
  reset-password  Set a new password and revoke all existing sessions.

Flags:
  --email      Account email address (required).
  --name       Display name for create-admin (default "Admin").
  --workspace  Workspace name for create-admin (default "<name>'s workspace").
  --password   Password. If omitted, admin-cli prompts without echo, or reads
               one line from stdin when input is piped. Passing a password in
               a command-line flag can leave it in shell history.

The command uses DATABASE_URL from the environment or .env.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "create-admin":
		err = runCreateAdmin(ctx, os.Args[2:])
	case "reset-password", "reset-pass":
		err = runResetPassword(ctx, os.Args[2:])
	case "help", "-h", "--help":
		fmt.Print(usage)
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}

	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func runCreateAdmin(parent context.Context, args []string) error {
	fs := flag.NewFlagSet("create-admin", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	email := fs.String("email", "", "account email address (required)")
	name := fs.String("name", "Admin", "display name")
	workspace := fs.String("workspace", "", "workspace name")
	passwordFlag := fs.String("password", "", "password (prompted when omitted)")
	fs.Usage = func() {
		fmt.Fprint(fs.Output(), "Usage: admin-cli create-admin --email EMAIL [--name NAME] [--workspace NAME] [--password PASSWORD]\n\n")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(fs.Args(), " "))
	}
	if strings.TrimSpace(*email) == "" {
		fs.Usage()
		return errors.New("--email is required")
	}

	password, err := resolvePassword(*passwordFlag)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	db, err := database.Open(ctx, config.DatabaseURL())
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer db.Close()

	account, err := admin.New(db).CreateOwner(ctx, admin.CreateOwnerInput{
		Name:          *name,
		Email:         *email,
		Password:      password,
		WorkspaceName: *workspace,
	})
	if err != nil {
		if errors.Is(err, admin.ErrEmailTaken) {
			return fmt.Errorf("%w; use reset-password to set a new password", err)
		}
		return err
	}

	fmt.Printf("Admin account created.\n")
	fmt.Printf("  Name:      %s\n", account.Name)
	fmt.Printf("  Email:     %s\n", account.Email)
	fmt.Printf("  Workspace: %s\n", account.WorkspaceName)
	fmt.Printf("  Role:      owner\n")
	return nil
}

func runResetPassword(parent context.Context, args []string) error {
	fs := flag.NewFlagSet("reset-password", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	email := fs.String("email", "", "account email address (required)")
	passwordFlag := fs.String("password", "", "new password (prompted when omitted)")
	fs.Usage = func() {
		fmt.Fprint(fs.Output(), "Usage: admin-cli reset-password --email EMAIL [--password PASSWORD]\n\n")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(fs.Args(), " "))
	}
	if strings.TrimSpace(*email) == "" {
		fs.Usage()
		return errors.New("--email is required")
	}

	password, err := resolvePassword(*passwordFlag)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	db, err := database.Open(ctx, config.DatabaseURL())
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer db.Close()

	account, err := admin.New(db).ResetPassword(ctx, *email, password)
	if err != nil {
		if errors.Is(err, admin.ErrUserNotFound) {
			return fmt.Errorf("%w; use create-admin to create it", err)
		}
		return err
	}

	fmt.Printf("Password reset for %s.\n", account.Email)
	fmt.Printf("All existing sessions for this account have been revoked.\n")
	return nil
}

func resolvePassword(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}

	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "Password: ")
		first, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", fmt.Errorf("read password: %w", err)
		}

		fmt.Fprint(os.Stderr, "Confirm password: ")
		second, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", fmt.Errorf("read password confirmation: %w", err)
		}
		if string(first) != string(second) {
			return "", errors.New("passwords do not match")
		}
		return string(first), nil
	}

	fmt.Fprintln(os.Stderr, "Reading password from standard input.")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("read password from stdin: %w", err)
	}
	line = strings.TrimSuffix(line, "\n")
	line = strings.TrimSuffix(line, "\r")
	if line == "" {
		return "", errors.New("password cannot be empty")
	}
	return line, nil
}

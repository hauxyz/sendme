package mailer

import (
	"context"
	"fmt"
	"net/mail"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"
)

type SMTPConfig struct {
	Host      string
	Port      int
	Security  string // none, starttls, tls
	Auth      string // none, plain, login
	Username  string
	Password  string
	FromEmail string
	FromName  string
	ReplyTo   string
}

type Message struct {
	To             string
	ToName         string
	Subject        string
	HTML           string
	Text           string
	Headers        map[string]string
	MessageID      string
	UnsubscribeURL string
}

type Service struct{}

func New() *Service {
	return &Service{}
}

func (s *Service) Send(ctx context.Context, cfg SMTPConfig, msg Message) error {
	if strings.TrimSpace(cfg.Host) == "" {
		return fmt.Errorf("SMTP host is not configured")
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return fmt.Errorf("invalid SMTP port")
	}
	if _, err := mail.ParseAddress(cfg.FromEmail); err != nil {
		return fmt.Errorf("invalid sender address: %w", err)
	}
	to, err := mail.ParseAddress(msg.To)
	if err != nil {
		return fmt.Errorf("invalid recipient address %q: %w", msg.To, err)
	}

	opts := []gomail.Option{
		gomail.WithPort(cfg.Port),
		gomail.WithTimeout(30 * time.Second),
		gomail.WithHELO("sendme"),
	}

	switch cfg.Security {
	case "tls":
		opts = append(opts, gomail.WithSSL())
	case "starttls":
		opts = append(opts, gomail.WithTLSPolicy(gomail.TLSMandatory))
	case "none", "":
		opts = append(opts, gomail.WithTLSPolicy(gomail.NoTLS))
	default:
		return fmt.Errorf("unsupported SMTP security mode %q", cfg.Security)
	}

	switch cfg.Auth {
	case "plain":
		opts = append(opts, gomail.WithSMTPAuth(gomail.SMTPAuthPlain), gomail.WithUsername(cfg.Username), gomail.WithPassword(cfg.Password))
	case "login":
		opts = append(opts, gomail.WithSMTPAuth(gomail.SMTPAuthLogin), gomail.WithUsername(cfg.Username), gomail.WithPassword(cfg.Password))
	case "none", "":
		// No authentication.
	default:
		return fmt.Errorf("unsupported SMTP authentication mode %q", cfg.Auth)
	}

	client, err := gomail.NewClient(cfg.Host, opts...)
	if err != nil {
		return fmt.Errorf("create SMTP client: %w", err)
	}

	message := gomail.NewMsg()
	if cfg.FromName != "" {
		err = message.FromFormat(cfg.FromName, cfg.FromEmail)
	} else {
		err = message.From(cfg.FromEmail)
	}
	if err != nil {
		return fmt.Errorf("set sender: %w", err)
	}
	if msg.ToName != "" {
		if err := message.AddToFormat(msg.ToName, to.Address); err != nil {
			return fmt.Errorf("set recipient: %w", err)
		}
	} else {
		if err := message.AddTo(to.Address); err != nil {
			return fmt.Errorf("set recipient: %w", err)
		}
	}

	replyTo := strings.TrimSpace(cfg.ReplyTo)
	if replyTo != "" {
		if _, err := mail.ParseAddress(replyTo); err == nil {
			if err := message.ReplyTo(replyTo); err != nil {
				return fmt.Errorf("set reply-to: %w", err)
			}
		}
	}
	message.Subject(msg.Subject)
	if msg.HTML != "" {
		message.SetBodyString(gomail.TypeTextHTML, msg.HTML)
		if msg.Text != "" {
			message.AddAlternativeString(gomail.TypeTextPlain, msg.Text)
		}
	} else if msg.Text != "" {
		message.SetBodyString(gomail.TypeTextPlain, msg.Text)
	}
	if msg.MessageID != "" {
		message.SetMessageIDWithValue(strings.Trim(msg.MessageID, "<>"))
	}
	message.SetUserAgent("SendMe/1.0")
	for key, value := range msg.Headers {
		if strings.TrimSpace(key) == "" || strings.ContainsAny(key, "\r\n") || strings.ContainsAny(value, "\r\n") {
			continue
		}
		message.SetGenHeader(gomail.Header(key), value)
	}
	if msg.UnsubscribeURL != "" {
		message.SetListUnsubscribe(msg.UnsubscribeURL)
		message.SetListUnsubscribePost()
	}

	sendCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err := client.DialAndSendWithContext(sendCtx, message); err != nil {
		return fmt.Errorf("SMTP send failed: %w", err)
	}
	return nil
}

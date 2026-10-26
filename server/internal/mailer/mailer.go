package mailer

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"sort"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"
)

const (
	ModeSMTP   = "smtp"
	ModeDirect = "direct"

	directAttemptTimeout  = 15 * time.Second
	directDeliveryTimeout = 55 * time.Second
)

var (
	directPort = 25
	lookupMXFn = lookupMailHosts
)

type DKIMConfig struct {
	Domain        string
	Selector      string
	PrivateKeyPEM string
}

type SMTPConfig struct {
	Mode      string // smtp (relay) or direct (recipient MX)
	Host      string
	Port      int
	Security  string // none, starttls, tls
	Auth      string // none, plain, login
	Username  string
	Password  string
	FromEmail string
	FromName  string
	ReplyTo   string
	HeloHost  string
	DKIM      *DKIMConfig
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
	if _, err := mail.ParseAddress(cfg.FromEmail); err != nil {
		return fmt.Errorf("invalid sender address: %w", err)
	}
	to, err := mail.ParseAddress(msg.To)
	if err != nil {
		return fmt.Errorf("invalid recipient address %q: %w", msg.To, err)
	}

	if cfg.Mode == ModeDirect {
		return s.sendDirect(ctx, cfg, msg, to)
	}
	return s.sendRelay(ctx, cfg, msg, to)
}

func (s *Service) sendRelay(ctx context.Context, cfg SMTPConfig, msg Message, to *mail.Address) error {
	if strings.TrimSpace(cfg.Host) == "" {
		return fmt.Errorf("SMTP host is not configured")
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return fmt.Errorf("invalid SMTP port")
	}

	opts := []gomail.Option{
		gomail.WithPort(cfg.Port),
		gomail.WithTimeout(30 * time.Second),
		gomail.WithHELO(heloHost(cfg)),
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
	message, err := s.buildMessage(cfg, msg, to)
	if err != nil {
		return err
	}
	sendCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err := client.DialAndSendWithContext(sendCtx, message); err != nil {
		return fmt.Errorf("SMTP send failed: %w", err)
	}
	return nil
}

// sendDirect delivers a message straight to the recipient domain's MX without
// an external relay. It is still SMTP; it only removes the need to configure or
// install an SMTP server of your own.
func (s *Service) sendDirect(ctx context.Context, cfg SMTPConfig, msg Message, to *mail.Address) error {
	recipientDomain, err := addressDomain(to.Address)
	if err != nil {
		return err
	}
	hosts, err := lookupMXFn(ctx, recipientDomain)
	if err != nil {
		return err
	}

	sendCtx, cancel := context.WithTimeout(ctx, directDeliveryTimeout)
	defer cancel()

	helo := heloHost(cfg)
	failures := make([]string, 0, len(hosts))
	for _, host := range hosts {
		if sendCtx.Err() != nil {
			break
		}
		attemptCtx, attemptCancel := context.WithTimeout(sendCtx, directAttemptTimeout)
		message, buildErr := s.buildMessage(cfg, msg, to)
		if buildErr != nil {
			attemptCancel()
			return buildErr
		}
		client, clientErr := gomail.NewClient(host,
			gomail.WithPort(directPort),
			gomail.WithTimeout(directAttemptTimeout),
			gomail.WithTLSPolicy(gomail.TLSOpportunistic),
			gomail.WithHELO(helo),
		)
		if clientErr != nil {
			attemptCancel()
			failures = append(failures, fmt.Sprintf("%s: %v", host, clientErr))
			continue
		}
		sendErr := client.DialAndSendWithContext(attemptCtx, message)
		attemptCancel()
		if sendErr == nil {
			return nil
		}
		failures = append(failures, fmt.Sprintf("%s: %v", host, sendErr))
	}
	if sendCtx.Err() != nil && len(failures) == 0 {
		return fmt.Errorf("direct delivery cancelled: %w", sendCtx.Err())
	}
	if len(failures) == 0 {
		return fmt.Errorf("direct delivery to %s failed", to.Address)
	}
	return fmt.Errorf("direct delivery to %s failed: %s", to.Address, strings.Join(failures, "; "))
}

func (s *Service) buildMessage(cfg SMTPConfig, msg Message, to *mail.Address) (*gomail.Msg, error) {
	message := gomail.NewMsg()
	var err error
	if cfg.FromName != "" {
		err = message.FromFormat(cfg.FromName, cfg.FromEmail)
	} else {
		err = message.From(cfg.FromEmail)
	}
	if err != nil {
		return nil, fmt.Errorf("set sender: %w", err)
	}
	if err := message.EnvelopeFrom(cfg.FromEmail); err != nil {
		return nil, fmt.Errorf("set envelope sender: %w", err)
	}
	if msg.ToName != "" {
		if err := message.AddToFormat(msg.ToName, to.Address); err != nil {
			return nil, fmt.Errorf("set recipient: %w", err)
		}
	} else {
		if err := message.AddTo(to.Address); err != nil {
			return nil, fmt.Errorf("set recipient: %w", err)
		}
	}

	replyTo := strings.TrimSpace(cfg.ReplyTo)
	if replyTo != "" {
		if _, err := mail.ParseAddress(replyTo); err == nil {
			if err := message.ReplyTo(replyTo); err != nil {
				return nil, fmt.Errorf("set reply-to: %w", err)
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
	if cfg.DKIM != nil && strings.TrimSpace(cfg.DKIM.PrivateKeyPEM) != "" {
		if strings.TrimSpace(cfg.DKIM.Domain) == "" || strings.TrimSpace(cfg.DKIM.Selector) == "" {
			return nil, fmt.Errorf("DKIM domain and selector are required when signing")
		}
		key, err := gomail.PrivKeyFromPEM([]byte(cfg.DKIM.PrivateKeyPEM))
		if err != nil {
			return nil, fmt.Errorf("load DKIM private key: %w", err)
		}
		signer := gomail.NewDKIMSigner(cfg.DKIM.Domain, cfg.DKIM.Selector, key)
		signer.SignHeaders(
			"From", "To", "Reply-To", "Subject", "Date", "Message-ID",
			"Content-Type", "MIME-Version", "List-Unsubscribe", "List-Unsubscribe-Post",
		)
		message.SetDKIM(signer)
	}
	return message, nil
}

func lookupMailHosts(ctx context.Context, domain string) ([]string, error) {
	records, err := net.DefaultResolver.LookupMX(ctx, domain)
	if err != nil {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
			// RFC 5321: without an MX record, delivery falls back to the
			// domain's address record.
			return []string{domain}, nil
		}
		return nil, fmt.Errorf("look up MX for %s: %w", domain, err)
	}
	if len(records) == 0 {
		return []string{domain}, nil
	}

	sort.SliceStable(records, func(i, j int) bool {
		return records[i].Pref < records[j].Pref
	})
	seen := map[string]bool{}
	hosts := make([]string, 0, len(records))
	for _, record := range records {
		host := strings.TrimSuffix(strings.TrimSpace(record.Host), ".")
		if host == "" || seen[strings.ToLower(host)] {
			continue
		}
		seen[strings.ToLower(host)] = true
		hosts = append(hosts, host)
	}
	if len(hosts) == 0 {
		return nil, fmt.Errorf("%s does not accept email (null MX)", domain)
	}
	return hosts, nil
}

func addressDomain(address string) (string, error) {
	at := strings.LastIndex(address, "@")
	if at < 0 || at == len(address)-1 {
		return "", fmt.Errorf("recipient address has no domain")
	}
	return strings.ToLower(strings.TrimSpace(address[at+1:])), nil
}

func heloHost(cfg SMTPConfig) string {
	if host := strings.TrimSpace(cfg.HeloHost); host != "" {
		return host
	}
	if cfg.DKIM != nil {
		if host := strings.TrimSpace(cfg.DKIM.Domain); host != "" {
			return host
		}
	}
	if domain, err := addressDomain(cfg.FromEmail); err == nil {
		return domain
	}
	return "localhost"
}

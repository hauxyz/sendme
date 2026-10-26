package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/hauxyz/sendme/server/internal/dkim"
	"github.com/hauxyz/sendme/server/internal/httpx"
	"github.com/hauxyz/sendme/server/internal/mailer"
)

type Domain struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	FromName          string     `json:"from_name"`
	FromEmail         string     `json:"from_email"`
	ReplyTo           string     `json:"reply_to"`
	SMTPHost          string     `json:"smtp_host"`
	SMTPPort          int        `json:"smtp_port"`
	SMTPSecurity      string     `json:"smtp_security"`
	SMTPAuth          string     `json:"smtp_auth"`
	SMTPUsername      string     `json:"smtp_username"`
	HasPassword       bool       `json:"has_password"`
	DeliveryMode      string     `json:"delivery_mode"`
	DKIMSelector      string     `json:"dkim_selector"`
	SMTPPasswordEnc   string     `json:"-"`
	DKIMPrivateKeyEnc string     `json:"-"`
	DKIMPublicKey     string     `json:"-"`
	Status            string     `json:"status"`
	LastError         string     `json:"last_error"`
	LastTestedAt      *time.Time `json:"last_tested_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	CampaignCount     int        `json:"campaign_count,omitempty"`
	EmailCount        int        `json:"email_count,omitempty"`
}

const domainColumns = `
	id, name, from_name, from_email, reply_to,
	smtp_host, smtp_port, smtp_security, smtp_auth, smtp_username, smtp_password_enc,
	delivery_mode, dkim_selector, dkim_private_key_enc, dkim_public_key,
	status, last_error, last_tested_at, created_at, updated_at
`

func scanDomain(row pgx.Row, d *Domain) error {
	err := row.Scan(
		&d.ID, &d.Name, &d.FromName, &d.FromEmail, &d.ReplyTo,
		&d.SMTPHost, &d.SMTPPort, &d.SMTPSecurity, &d.SMTPAuth, &d.SMTPUsername, &d.SMTPPasswordEnc,
		&d.DeliveryMode, &d.DKIMSelector, &d.DKIMPrivateKeyEnc, &d.DKIMPublicKey,
		&d.Status, &d.LastError, &d.LastTestedAt, &d.CreatedAt, &d.UpdatedAt,
	)
	if err == nil {
		d.HasPassword = d.SMTPPasswordEnc != ""
	}
	return err
}

func (s *Server) listDomains(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT `+domainColumns+`,
			(SELECT count(*) FROM campaigns c WHERE c.from_domain_id = domains.id) AS campaign_count,
			(SELECT count(*) FROM emails e WHERE e.domain_id = domains.id) AS email_count
		FROM domains
		WHERE workspace_id = $1
		ORDER BY created_at DESC
	`, workspaceID(r))
	if err != nil {
		s.logger.Error("list domains", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load domains")
		return
	}
	defer rows.Close()

	domains := make([]Domain, 0)
	for rows.Next() {
		var d Domain
		if err := rows.Scan(
			&d.ID, &d.Name, &d.FromName, &d.FromEmail, &d.ReplyTo,
			&d.SMTPHost, &d.SMTPPort, &d.SMTPSecurity, &d.SMTPAuth, &d.SMTPUsername, &d.SMTPPasswordEnc,
			&d.DeliveryMode, &d.DKIMSelector, &d.DKIMPrivateKeyEnc, &d.DKIMPublicKey,
			&d.Status, &d.LastError, &d.LastTestedAt, &d.CreatedAt, &d.UpdatedAt,
			&d.CampaignCount, &d.EmailCount,
		); err != nil {
			s.logger.Error("scan domain", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load domains")
			return
		}
		d.HasPassword = d.SMTPPasswordEnc != ""
		domains = append(domains, d)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"domains": domains})
}

type domainInput struct {
	Name         string  `json:"name"`
	FromName     string  `json:"from_name"`
	FromEmail    string  `json:"from_email"`
	ReplyTo      string  `json:"reply_to"`
	DeliveryMode string  `json:"delivery_mode"`
	SMTPHost     string  `json:"smtp_host"`
	SMTPPort     int     `json:"smtp_port"`
	SMTPSecurity string  `json:"smtp_security"`
	SMTPAuth     string  `json:"smtp_auth"`
	SMTPUsername string  `json:"smtp_username"`
	SMTPPassword string  `json:"smtp_password"`
	Status       *string `json:"status"`
}

func (s *Server) createDomain(w http.ResponseWriter, r *http.Request) {
	var req domainInput
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	normalizeDomainInput(&req)
	if message := validateDomainInput(&req, true); message != "" {
		httpx.Error(w, http.StatusBadRequest, "invalid_domain", message)
		return
	}

	selector := dkim.DefaultSelector
	var encryptedDKIM, publicDKIM string
	if req.DeliveryMode == mailer.ModeDirect {
		privatePEM, publicRecord, err := dkim.Generate()
		if err != nil {
			s.logger.Error("generate DKIM key", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not generate a DKIM key for the domain")
			return
		}
		encryptedDKIM, err = s.sealer.Encrypt(privatePEM)
		if err != nil {
			s.logger.Error("encrypt DKIM key", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not save the DKIM key")
			return
		}
		publicDKIM = publicRecord
	}

	encrypted := ""
	if req.DeliveryMode == mailer.ModeSMTP && req.SMTPPassword != "" {
		var err error
		encrypted, err = s.sealer.Encrypt(req.SMTPPassword)
		if err != nil {
			s.logger.Error("encrypt smtp password", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not save the SMTP password")
			return
		}
	}

	id := uuid.NewString()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO domains (
			id, workspace_id, name, from_name, from_email, reply_to,
			smtp_host, smtp_port, smtp_security, smtp_auth, smtp_username, smtp_password_enc,
			delivery_mode, dkim_selector, dkim_private_key_enc, dkim_public_key, status
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')
	`, id, workspaceID(r), req.Name, req.FromName, req.FromEmail, req.ReplyTo,
		req.SMTPHost, req.SMTPPort, req.SMTPSecurity, req.SMTPAuth, req.SMTPUsername, encrypted,
		req.DeliveryMode, selector, encryptedDKIM, publicDKIM)
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "domain_exists", "This domain is already configured")
			return
		}
		s.logger.Error("create domain", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not create the domain")
		return
	}

	d, err := s.loadDomain(r.Context(), workspaceID(r), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the domain")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"domain": d})
}

func (s *Server) getDomain(w http.ResponseWriter, r *http.Request) {
	d, err := s.loadDomain(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "domain_not_found", "Domain not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"domain": d})
}

func (s *Server) updateDomain(w http.ResponseWriter, r *http.Request) {
	domainID := chi.URLParam(r, "id")
	existing, err := s.loadDomain(r.Context(), workspaceID(r), domainID)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "domain_not_found", "Domain not found")
		return
	}
	var req struct {
		Name         *string `json:"name"`
		FromName     *string `json:"from_name"`
		FromEmail    *string `json:"from_email"`
		ReplyTo      *string `json:"reply_to"`
		DeliveryMode *string `json:"delivery_mode"`
		SMTPHost     *string `json:"smtp_host"`
		SMTPPort     *int    `json:"smtp_port"`
		SMTPSecurity *string `json:"smtp_security"`
		SMTPAuth     *string `json:"smtp_auth"`
		SMTPUsername *string `json:"smtp_username"`
		SMTPPassword *string `json:"smtp_password"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	identityChanged := false
	if req.Name != nil {
		name := normalizeDomain(*req.Name)
		identityChanged = identityChanged || name != existing.Name
		existing.Name = name
	}
	if req.FromName != nil {
		existing.FromName = strings.TrimSpace(*req.FromName)
	}
	if req.FromEmail != nil {
		email := strings.ToLower(strings.TrimSpace(*req.FromEmail))
		identityChanged = identityChanged || email != existing.FromEmail
		existing.FromEmail = email
	}
	if req.ReplyTo != nil {
		existing.ReplyTo = strings.ToLower(strings.TrimSpace(*req.ReplyTo))
	}

	deliveryMode := strings.ToLower(strings.TrimSpace(existing.DeliveryMode))
	if deliveryMode == "" {
		deliveryMode = mailer.ModeSMTP
	}
	connChanged := false
	if req.DeliveryMode != nil {
		requested := strings.ToLower(strings.TrimSpace(*req.DeliveryMode))
		if requested != "" && requested != deliveryMode {
			connChanged = true
			deliveryMode = requested
		}
	}

	password := ""
	if deliveryMode == mailer.ModeSMTP {
		if req.SMTPHost != nil {
			connChanged = connChanged || *req.SMTPHost != existing.SMTPHost
			existing.SMTPHost = *req.SMTPHost
		}
		if req.SMTPPort != nil {
			connChanged = connChanged || *req.SMTPPort != existing.SMTPPort
			existing.SMTPPort = *req.SMTPPort
		}
		if req.SMTPSecurity != nil {
			connChanged = connChanged || *req.SMTPSecurity != existing.SMTPSecurity
			existing.SMTPSecurity = *req.SMTPSecurity
		}
		if req.SMTPAuth != nil {
			connChanged = connChanged || *req.SMTPAuth != existing.SMTPAuth
			existing.SMTPAuth = *req.SMTPAuth
		}
		if req.SMTPUsername != nil {
			connChanged = connChanged || *req.SMTPUsername != existing.SMTPUsername
			existing.SMTPUsername = *req.SMTPUsername
		}
		if req.SMTPPassword != nil && *req.SMTPPassword != "" {
			password = *req.SMTPPassword
			connChanged = true
		}
	}

	input := domainInput{
		Name: existing.Name, FromName: existing.FromName, FromEmail: existing.FromEmail, ReplyTo: existing.ReplyTo,
		DeliveryMode: deliveryMode,
		SMTPHost:     existing.SMTPHost, SMTPPort: existing.SMTPPort, SMTPSecurity: existing.SMTPSecurity,
		SMTPAuth: existing.SMTPAuth, SMTPUsername: existing.SMTPUsername, SMTPPassword: password,
	}
	normalizeDomainInput(&input)
	requirePassword := input.DeliveryMode == mailer.ModeSMTP && (existing.SMTPPasswordEnc == "" || password != "")
	if message := validateDomainInput(&input, requirePassword); message != "" {
		httpx.Error(w, http.StatusBadRequest, "invalid_domain", message)
		return
	}

	passwordEnc := existing.SMTPPasswordEnc
	if input.DeliveryMode == mailer.ModeDirect {
		passwordEnc = ""
	}
	if password != "" {
		passwordEnc, err = s.sealer.Encrypt(password)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not save the SMTP password")
			return
		}
	}

	selector := existing.DKIMSelector
	if selector == "" {
		selector = dkim.DefaultSelector
	}
	dkimPrivateEnc := existing.DKIMPrivateKeyEnc
	dkimPublic := existing.DKIMPublicKey
	if input.DeliveryMode == mailer.ModeDirect && (dkimPrivateEnc == "" || dkimPublic == "") {
		privatePEM, publicRecord, err := dkim.Generate()
		if err != nil {
			s.logger.Error("generate DKIM key", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not generate a DKIM key for the domain")
			return
		}
		dkimPrivateEnc, err = s.sealer.Encrypt(privatePEM)
		if err != nil {
			s.logger.Error("encrypt DKIM key", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not save the DKIM key")
			return
		}
		dkimPublic = publicRecord
	}

	status := existing.Status
	lastError := existing.LastError
	if connChanged || identityChanged {
		status = "pending"
		lastError = ""
	}

	_, err = s.db.Exec(r.Context(), `
		UPDATE domains SET
			name = $1, from_name = $2, from_email = $3, reply_to = $4,
			smtp_host = $5, smtp_port = $6, smtp_security = $7, smtp_auth = $8, smtp_username = $9,
			smtp_password_enc = $10, delivery_mode = $11, dkim_selector = $12,
			dkim_private_key_enc = $13, dkim_public_key = $14,
			status = $15, last_error = $16, updated_at = now()
		WHERE id = $17 AND workspace_id = $18
	`, input.Name, input.FromName, input.FromEmail, input.ReplyTo,
		input.SMTPHost, input.SMTPPort, input.SMTPSecurity, input.SMTPAuth, input.SMTPUsername,
		passwordEnc, input.DeliveryMode, selector, dkimPrivateEnc, dkimPublic,
		status, lastError, domainID, workspaceID(r))
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, "domain_exists", "This domain is already configured")
			return
		}
		s.logger.Error("update domain", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not update the domain")
		return
	}
	d, err := s.loadDomain(r.Context(), workspaceID(r), domainID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not load the domain")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"domain": d})
}

func (s *Server) deleteDomain(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `DELETE FROM domains WHERE id = $1 AND workspace_id = $2`, chi.URLParam(r, "id"), workspaceID(r))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not delete the domain")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "domain_not_found", "Domain not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) testDomain(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req struct {
		To string `json:"to"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.To = strings.TrimSpace(req.To)
	if req.To == "" {
		req.To = user.Email
	}
	if !validEmail(req.To) {
		httpx.Error(w, http.StatusBadRequest, "invalid_email", "Enter a valid test recipient address")
		return
	}

	domainID := chi.URLParam(r, "id")
	d, err := s.loadDomain(r.Context(), workspaceID(r), domainID)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "domain_not_found", "Domain not found")
		return
	}

	direct := d.DeliveryMode == mailer.ModeDirect
	password := ""
	dkimPrivate := ""
	if direct {
		if d.DKIMPrivateKeyEnc == "" {
			httpx.Error(w, http.StatusUnprocessableEntity, "domain_not_ready", "This domain does not have a DKIM key yet. Edit and save the domain to generate one.")
			return
		}
		dkimPrivate, err = s.sealer.Decrypt(d.DKIMPrivateKeyEnc)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not read the DKIM key")
			return
		}
	} else {
		password, err = s.domainPassword(r, domainID)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal_error", "Could not read the SMTP password")
			return
		}
	}

	var html, text, subject string
	if direct {
		html = fmt.Sprintf(`<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111827;">
		<h1 style="font-size:24px;margin:0 0 12px;">Your direct delivery works</h1>
		<p style="line-height:1.6;">This test email was sent directly from <strong>%s</strong> to the recipient's mail server on port 25.</p>
		<p style="line-height:1.6;">No external SMTP relay was used. You can now use this domain to send transactional emails and campaigns from SendMe.</p>
	</div>`, htmlEscape(d.FromEmail))
		text = "Your direct delivery works. This test email was sent from " + d.FromEmail + " without an SMTP relay."
		subject = "SendMe direct delivery test — " + d.Name
	} else {
		html = fmt.Sprintf(`<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111827;">
		<h1 style="font-size:24px;margin:0 0 12px;">Your SMTP setup works</h1>
		<p style="line-height:1.6;">This test email was sent from <strong>%s</strong> using %s:%d.</p>
		<p style="line-height:1.6;">You can now use this domain to send transactional emails and campaigns from SendMe.</p>
	</div>`, htmlEscape(d.FromEmail), htmlEscape(d.SMTPHost), d.SMTPPort)
		text = "Your SMTP setup works. This test email was sent from " + d.FromEmail + "."
		subject = "SendMe SMTP test — " + d.Name
	}

	cfg := mailer.SMTPConfig{
		Mode: d.DeliveryMode, Host: d.SMTPHost, Port: d.SMTPPort, Security: d.SMTPSecurity, Auth: d.SMTPAuth,
		Username: d.SMTPUsername, Password: password, FromEmail: d.FromEmail, FromName: d.FromName, ReplyTo: d.ReplyTo,
		HeloHost: s.cfg.MailHeloHost,
	}
	if direct {
		cfg.DKIM = &mailer.DKIMConfig{Domain: d.Name, Selector: d.DKIMSelector, PrivateKeyPEM: dkimPrivate}
	}
	err = s.mailer.Send(r.Context(), cfg, mailer.Message{
		To:      req.To,
		Subject: subject,
		HTML:    html,
		Text:    text,
	})

	if err != nil {
		message := truncate(err.Error(), 1000)
		_, _ = s.db.Exec(r.Context(), `
			UPDATE domains SET status = 'error', last_error = $1, last_tested_at = now(), updated_at = now()
			WHERE id = $2 AND workspace_id = $3
		`, message, domainID, workspaceID(r))
		httpx.Error(w, http.StatusUnprocessableEntity, "delivery_failed", "Delivery test failed: "+message)
		return
	}

	_, _ = s.db.Exec(r.Context(), `
		UPDATE domains SET status = 'active', last_error = '', last_tested_at = now(), updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, domainID, workspaceID(r))
	how := "your SMTP server"
	if direct {
		how = "the recipient's mail server"
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Test email accepted by " + how + " for " + req.To})
}

func (s *Server) domainPassword(r *http.Request, domainID string) (string, error) {
	var encrypted string
	err := s.db.QueryRow(r.Context(), `SELECT smtp_password_enc FROM domains WHERE id = $1 AND workspace_id = $2`, domainID, workspaceID(r)).Scan(&encrypted)
	if err != nil {
		return "", err
	}
	if encrypted == "" {
		return "", nil
	}
	return s.sealer.Decrypt(encrypted)
}

func (s *Server) loadDomain(ctx context.Context, workspace, domainID string) (*Domain, error) {
	row := s.db.QueryRow(ctx, `SELECT `+domainColumns+` FROM domains WHERE id = $1 AND workspace_id = $2`, domainID, workspace)
	var d Domain
	if err := scanDomain(row, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

func normalizeDomainInput(req *domainInput) {
	req.Name = normalizeDomain(req.Name)
	req.FromName = strings.TrimSpace(req.FromName)
	req.FromEmail = strings.ToLower(strings.TrimSpace(req.FromEmail))
	req.ReplyTo = strings.ToLower(strings.TrimSpace(req.ReplyTo))
	req.DeliveryMode = strings.ToLower(strings.TrimSpace(req.DeliveryMode))
	if req.DeliveryMode == "" {
		if strings.TrimSpace(req.SMTPHost) != "" {
			req.DeliveryMode = mailer.ModeSMTP
		} else {
			req.DeliveryMode = mailer.ModeDirect
		}
	}
	if req.DeliveryMode == mailer.ModeDirect {
		req.SMTPHost = ""
		req.SMTPPort = 0
		req.SMTPSecurity = "none"
		req.SMTPAuth = "none"
		req.SMTPUsername = ""
		req.SMTPPassword = ""
	} else {
		req.SMTPHost = strings.TrimSpace(req.SMTPHost)
		req.SMTPSecurity = strings.ToLower(strings.TrimSpace(req.SMTPSecurity))
		req.SMTPAuth = strings.ToLower(strings.TrimSpace(req.SMTPAuth))
		req.SMTPUsername = strings.TrimSpace(req.SMTPUsername)
		if req.SMTPPort == 0 {
			req.SMTPPort = 587
		}
		if req.SMTPSecurity == "" {
			req.SMTPSecurity = "starttls"
		}
		if req.SMTPAuth == "" {
			req.SMTPAuth = "plain"
		}
	}
	if req.FromEmail == "" && req.Name != "" {
		req.FromEmail = "noreply@" + req.Name
	}
}

func validateDomainInput(req *domainInput, requirePassword bool) string {
	if !validDomain(req.Name) {
		return "Enter a valid domain name, for example example.com"
	}
	if !validEmail(req.FromEmail) {
		return "Enter a valid sender email address"
	}
	parts := strings.SplitN(strings.ToLower(req.FromEmail), "@", 2)
	if len(parts) != 2 || parts[1] != req.Name {
		return "The sender email must use the configured domain"
	}
	if req.ReplyTo != "" && !validEmail(req.ReplyTo) {
		return "Enter a valid reply-to email address"
	}
	if req.DeliveryMode != mailer.ModeDirect && req.DeliveryMode != mailer.ModeSMTP {
		return "Choose a valid delivery mode"
	}
	if req.DeliveryMode == mailer.ModeDirect {
		return ""
	}
	if req.SMTPHost == "" || len(req.SMTPHost) > 255 || strings.ContainsAny(req.SMTPHost, " \t\r\n/") {
		return "Enter a valid SMTP host"
	}
	if req.SMTPPort < 1 || req.SMTPPort > 65535 {
		return "SMTP port must be between 1 and 65535"
	}
	if req.SMTPSecurity != "none" && req.SMTPSecurity != "starttls" && req.SMTPSecurity != "tls" {
		return "Choose a valid SMTP security mode"
	}
	if req.SMTPAuth != "none" && req.SMTPAuth != "plain" && req.SMTPAuth != "login" {
		return "Choose a valid SMTP authentication mode"
	}
	if req.SMTPAuth != "none" {
		if strings.TrimSpace(req.SMTPUsername) == "" {
			return "SMTP username is required for the selected authentication mode"
		}
		if requirePassword && req.SMTPPassword == "" {
			return "SMTP password is required for the selected authentication mode"
		}
	}
	return ""
}

func (s *Server) domainDNS(w http.ResponseWriter, r *http.Request) {
	d, err := s.loadDomain(r.Context(), workspaceID(r), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "domain_not_found", "Domain not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	resolver := net.DefaultResolver

	type check struct {
		Type        string   `json:"type"`
		Name        string   `json:"name"`
		Found       bool     `json:"found"`
		Values      []string `json:"values"`
		Description string   `json:"description"`
		Recommended string   `json:"recommended,omitempty"`
	}
	direct := d.DeliveryMode == mailer.ModeDirect
	checks := make([]check, 0, 4)

	mxRecords, _ := resolver.LookupMX(ctx, d.Name)
	mxValues := make([]string, 0, len(mxRecords))
	for _, record := range mxRecords {
		mxValues = append(mxValues, fmt.Sprintf("%d %s", record.Pref, strings.TrimSuffix(record.Host, ".")))
	}
	mxDescription := "A mail exchanger helps receivers validate that the domain accepts email."
	if direct {
		mxDescription = "Optional for sending: an MX record is only needed if you want to receive replies or bounces. Direct delivery looks up the recipient's MX, not yours."
	}
	checks = append(checks, check{
		Type: "MX", Name: d.Name, Found: len(mxValues) > 0, Values: mxValues,
		Description: mxDescription,
	})

	txtRecords, _ := resolver.LookupTXT(ctx, d.Name)
	spfValues := make([]string, 0)
	for _, txt := range txtRecords {
		if strings.HasPrefix(strings.ToLower(txt), "v=spf1") {
			spfValues = append(spfValues, txt)
		}
	}
	spfDescription := "Authorize your SMTP relay to send email on behalf of this domain."
	if direct {
		spfDescription = "Authorize this server's public IP to send direct-to-MX email for this domain. Merge the ip4/ip6 mechanism into an existing SPF record rather than creating a second one."
	}
	checks = append(checks, check{
		Type: "SPF", Name: d.Name, Found: len(spfValues) > 0, Values: spfValues,
		Description: spfDescription, Recommended: s.spfRecommendedRecord(),
	})

	if direct {
		selector := d.DKIMSelector
		if selector == "" {
			selector = dkim.DefaultSelector
		}
		dkimName := selector + "._domainkey." + d.Name
		dkimRecords, _ := resolver.LookupTXT(ctx, dkimName)
		dkimValues := make([]string, 0)
		for _, txt := range dkimRecords {
			if strings.HasPrefix(strings.ToLower(txt), "v=dkim1") {
				dkimValues = append(dkimValues, txt)
			}
		}
		checks = append(checks, check{
			Type: "DKIM", Name: dkimName, Found: len(dkimValues) > 0, Values: dkimValues,
			Description: "Publish this TXT record so receivers can verify the DKIM signature added to every outgoing message.",
			Recommended: d.DKIMPublicKey,
		})
	}

	dmarcRecords, _ := resolver.LookupTXT(ctx, "_dmarc."+d.Name)
	dmarcValues := make([]string, 0)
	for _, txt := range dmarcRecords {
		if strings.HasPrefix(strings.ToLower(txt), "v=dmarc1") {
			dmarcValues = append(dmarcValues, txt)
		}
	}
	checks = append(checks, check{
		Type: "DMARC", Name: "_dmarc." + d.Name, Found: len(dmarcValues) > 0, Values: dmarcValues,
		Description: "Tell receivers how to handle email that fails authentication.",
		Recommended: "v=DMARC1; p=none; rua=mailto:postmaster@" + d.Name,
	})

	note := "DKIM is usually added by your SMTP relay. Check your provider's documentation for the exact DKIM selector."
	if direct {
		note = "Direct delivery needs outbound TCP port 25, SPF, and a PTR record for the EHLO host. SendMe does not receive inbound messages or bounces."
		if s.cfg.MailHeloHost != "" {
			note += " The configured EHLO host is " + s.cfg.MailHeloHost + "."
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"domain":     d.Name,
		"checks":     checks,
		"checked_at": time.Now().UTC(),
		"note":       note,
	})
}

func (s *Server) spfRecommendedRecord() string {
	if s.cfg.MailPublicIP == "" {
		return "v=spf1 ip4:YOUR_PUBLIC_IP -all"
	}
	prefix := "ip4:"
	if strings.Contains(s.cfg.MailPublicIP, ":") {
		prefix = "ip6:"
	}
	return "v=spf1 " + prefix + s.cfg.MailPublicIP + " -all"
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return replacer.Replace(value)
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

func parseAddress(value string) (*mail.Address, error) {
	return mail.ParseAddress(value)
}

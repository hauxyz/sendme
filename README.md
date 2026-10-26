# SendMe

SendMe is a self-hosted email platform in the spirit of UseSend, built only with **Go, Next.js, PostgreSQL, and Redis**. It sends exclusively through **SMTP**: either Go's built-in direct-to-MX delivery with no relay to install, or any SMTP relay such as a local server, Amazon SES, Mailgun, SendGrid, or Postmark. There is no third-party sending API.

Use it as a transactional email API, a campaign sender, a contact manager, or a full dashboard for several sending domains.

## Features

- **Direct delivery or SMTP relay** — send from Go straight to each recipient's MX without installing an SMTP server, or connect any SMTP relay. Each domain stores its own mode, sender identity, TLS mode, authentication mode, and encrypted credentials.
- **Multiple sending domains** — configure direct delivery, a local relay, Amazon SES, or any custom SMTP service per domain. Direct domains get a generated DKIM key and DNS guidance.
- **useSend-compatible API** — the public `/api/v1` API mirrors useSend request and response shapes for emails, domains, contact books, campaigns, and analytics. It is proxied same-origin through Next.js with workspace API keys, scheduling, idempotency keys, custom headers, and open/click tracking.
- **Campaigns** — draft, preview, send immediately, schedule, cancel, and delete. Campaigns render per-contact template variables and add an unsubscribe footer automatically.
- **Contacts and audiences** — create, search, filter, paginate, edit, delete, import CSV, and manage audience membership in bulk.
- **Email log** — inspect rendered content, delivery status, attempts, tracking events, and retry failed messages.
- **Webhooks** — subscribe to delivery and engagement events, sign deliveries with HMAC-SHA256, send test events, and review delivery history.
- **API keys** — workspace-scoped bearer keys, shown in full once, with a per-key rate limit of 120 requests per minute.
- **Analytics** — workspace overview with send, delivery, open, and click metrics.
- **Multi-workspace membership** — an account can belong to more than one workspace and switch from the sidebar. Domains, contacts, campaigns, analytics, API keys, and webhooks stay isolated per workspace.
- **Platform administration** — platform administrators can list and manage every user and workspace, create accounts, reset passwords, transfer memberships, and promote other administrators from the dashboard. The `admin-cli` remains available for bootstrap and recovery.
- **Single-binary backend** — the HTTP API and background worker (asynq + Redis) run in one Go process.

## Stack

| Layer | Technology |
| --- | --- |
| API and worker | Go 1.26, chi, pgx, asynq, go-mail |
| Dashboard | Next.js 16 App Router, React 19, Tailwind CSS v4, SWR |
| Database | PostgreSQL 18 |
| Queue and rate limits | Redis 7 |
| Auth | JWT in an HttpOnly cookie, Argon2id passwords |
| Secrets | AES-256-GCM for SMTP passwords and DKIM keys |
| Authentication (outbound) | SPF, DKIM (RSA-2048), DMARC guidance |

## Quick start with Docker

Requirements: Docker with Compose, and `openssl`.

```bash
git clone <your-repo-url> sendme
cd sendme
make init          # creates .env with random JWT, encryption, and signing secrets
make up            # builds and starts Postgres, Redis, the API, and the dashboard
```

Open [http://localhost:3000](http://localhost:3000) and create the first account. The public API is available on the same origin at [http://localhost:3000/api/v1](http://localhost:3000/api/v1). The Go backend also listens on `http://localhost:8080` for internal use, with its health check at `GET /healthz`.

Database migrations run automatically when the API starts.

```bash
make logs          # follow API and web logs
make down          # stop everything
```

The defaults map ports `3000`, `8080`, `5432`, and `6379`. Override them with `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, and `REDIS_PORT` in `.env`.

## Local development

Requirements: Go 1.26+, Node.js 24+, PostgreSQL 18+, and Redis 7+. Docker can provide Postgres and Redis.

```bash
make init          # only if .env does not exist yet
make infra-up      # start Postgres and Redis containers
cd web && npm install && cd ..
make dev           # API on :8080 and Next.js on :3000
```

`make dev` runs the API with the worker enabled. Use `make api` and `make web` in separate terminals if you prefer. `make check` runs gofmt, `go vet`, backend tests, ESLint, and TypeScript.

The frontend calls the API through the same-origin route `/api/proxy/*`. The public useSend-compatible API is exposed through `/api/v1/*`; both proxies forward to the Go backend. In development the target is `http://localhost:8080`; in Docker it is `http://server:8080`. Override it with `API_INTERNAL_URL`.

## Admin CLI

Platform administrators get an **Administration** section in the dashboard after signing in. They can manage every account and workspace, including creating users, resetting passwords, editing membership, and promoting or demoting other platform administrators.

Use `admin-cli` for the first account or for recovery when nobody can sign in. Interactive passwords are prompted without echo and are never printed.

Create a workspace owner and platform administrator:

```bash
docker compose exec server admin-cli create-admin \
  --email admin@example.com \
  --name "Admin" \
  --workspace "Acme"
```

Reset a password and revoke every existing session for that account:

```bash
docker compose exec server admin-cli reset-password --email admin@example.com
```

For local development, use `make admin-cli ARGS='...'` or run `server/bin/admin-cli ...` after `make build`. For non-interactive automation, pipe the password on stdin:

```bash
printf '%s\n' "$NEW_PASSWORD" | docker compose exec -T server admin-cli reset-password --email admin@example.com
```

Grant or revoke platform administrator access for an existing account:

```bash
docker compose exec server admin-cli promote --email admin@example.com
docker compose exec server admin-cli demote --email admin@example.com
```

`create-admin` fails if the email is already registered; use `reset-password` for existing accounts. The CLI reads `DATABASE_URL` from the environment or `.env`. If a password is supplied with `--password`, it may be visible in shell history and process listings, so interactive input is preferred.

For the isolated production stack, use `make prod-admin-cli ARGS='...'` instead of `docker compose exec`.

## Configuration

Copy `.env.example` to `.env` (or run `make init`) and adjust the values. The backend also reads `.env` from the repository root, `server/`, and one directory above.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_ENV` | `development` | Set to `production` to require explicit secrets. |
| `PORT` | `8080` | API listen port. |
| `APP_URL` | `http://localhost:3000` | Public dashboard origin. The API, tracking, click and unsubscribe routes are served from `<APP_URL>/api`; also used for CORS and trusted origins. |
| `DATABASE_URL` | local `sendme` database | PostgreSQL connection string. |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string. |
| `JWT_SECRET` | development fallback | Signs session cookies. Required in production. |
| `ENCRYPTION_KEY` | derived in development | Base64-encoded 32-byte key for SMTP and DKIM secret encryption. Required in production. |
| `SIGNING_SECRET` | `JWT_SECRET` | Signs tracking links and unsubscribe tokens. |
| `SESSION_TTL` | `168h` | Session lifetime. |
| `COOKIE_SECURE` | auto from `APP_URL` | Force the `Secure` cookie flag. |
| `COOKIE_DOMAIN` | empty | Optional cookie domain. |
| `TRUSTED_ORIGINS` | `APP_URL` | Comma-separated extra CORS origins. |
| `WORKER_ENABLED` | `true` | Run the background worker inside the API process. |
| `WORKER_CONCURRENCY` | `10` | Worker concurrency. |
| `MAIL_HELO_HOST` | sender domain | EHLO hostname for direct delivery. Set it to a hostname whose PTR record points at the server's public IP. |
| `MAIL_PUBLIC_IP` | empty | Optional public IPv4/IPv6 address used to display the exact SPF record in DNS diagnostics. |
| `NEXT_PUBLIC_APP_URL` | `APP_URL` | Build-time public origin rendered in dashboard API examples. Compose and `make` derive it from `APP_URL`; no separate value is normally needed. |
| `API_INTERNAL_URL` | `http://localhost:8080` | Server-side proxy target used by Next.js. |
| `ENV_FILE` | `.env` | Compose env file loaded by the server service. `make init-prod` sets this to `.env.prod`. |
| `COMPOSE_PROJECT_NAME` | `sendme` | Docker Compose project name. `make init-prod` sets this to `sendme-prod` so production containers and volumes stay separate from development. |

Generate secrets with:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 32   # SIGNING_SECRET
```

## Add a sending domain

Each domain uses one of two delivery modes:

- **Direct delivery** — Go resolves each recipient's MX and delivers over SMTP port 25 with opportunistic STARTTLS. No SMTP server is installed. SendMe generates a DKIM RSA-2048 key for the domain.
- **SMTP relay** — SendMe connects to an SMTP server you choose. The dashboard includes presets for a local relay, Amazon SES, Gmail/Google Workspace, Mailgun, SendGrid, Postmark, and a custom relay. Presets only fill in the form; sending is always plain SMTP.

To add a domain:

1. Open **Domains → Add domain**.
2. Enter the domain name and sender identity (`From` name and address).
3. Choose a provider / delivery mode.
   - **Direct delivery:** no host or credentials are needed. Publish the generated DKIM record and an SPF record that authorizes this server's public IP. Set `MAIL_HELO_HOST` to a hostname with a matching PTR record.
   - **Local SMTP:** from Docker, `host.docker.internal` points to the machine running Docker. The relay must accept connections from the container.
   - **Amazon SES:** use SES SMTP credentials (not IAM access keys) and replace `us-east-1` with your SES region. Amazon SNS is a notification service and is not an SMTP email sender.
   - **Other relays:** use the SMTP host, port, security, and credentials from the provider.
4. Save, choose a test recipient, and run **Test delivery**. A domain becomes `active` only after the recipient's MX or your relay accepts a real test email.
5. Open **DNS** to inspect MX, SPF, DKIM, and DMARC records. Direct domains show the DKIM TXT value and a recommended SPF record based on `MAIL_PUBLIC_IP`.

Only active domains can send email. The `From` address must belong to the selected domain. Reply-to, tracking, and unsubscribe behavior are configured per message or campaign.

### Direct delivery requirements

Direct delivery avoids an external relay but still needs working email infrastructure:

- Outbound TCP port 25 must be open. Many ISPs and cloud providers block it; use an SMTP relay if yours does.
- The server should have a static public IP with a PTR record matching `MAIL_HELO_HOST` (or the sender domain when unset).
- Publish SPF, DKIM, and DMARC for the sending domain.
- SendMe does not listen for inbound mail. Bounces and replies go to the `From`/`Reply-To` mailbox specified in the domain; SendMe cannot process bounce messages.
- Direct delivery is best for small, controlled volumes. High-volume senders should use a reputable SMTP relay for IP reputation and feedback loops.

Presets for provider settings are UI conveniences only. SendMe does not call Amazon, Mailgun, SendGrid, or any other vendor API.

## Send with the API

Create a key under **API keys**, then call the same-origin useSend-compatible API:

```bash
curl -X POST http://localhost:3000/api/v1/emails \
  -H "Authorization: Bearer sm_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: welcome-42" \
  -d '{
    "from": "Acme <hello@example.com>",
    "to": "customer@example.com",
    "subject": "Welcome to Acme",
    "html": "<h1>Hello</h1><p>Your account is ready.</p>",
    "text": "Hello, your account is ready.",
    "trackOpens": true,
    "trackClicks": true
  }'
```

The response is `{ "emailId": "..." }`. Multi-recipient and batch requests may also include `emailIds`. The API resolves the active sending domain from the `from` address.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/me` | Resolve the workspace for the current key. |
| `GET` | `/api/v1/domains` | List sending domains. |
| `POST` | `/api/v1/domains` | Create a direct-delivery domain. |
| `GET` | `/api/v1/domains/{id}` | Get one domain. |
| `PUT` | `/api/v1/domains/{id}/verify` | Re-run domain verification. |
| `DELETE` | `/api/v1/domains/{id}` | Delete a domain. |
| `POST` | `/api/v1/emails` | Send or schedule up to 50 recipients. |
| `POST` | `/api/v1/emails/batch` | Send up to 100 email requests. |
| `GET` | `/api/v1/emails` | List emails with pagination and date filters. |
| `GET` | `/api/v1/emails/{id}` | Retrieve one email, including events. |
| `PATCH` | `/api/v1/emails/{id}` | Reschedule a queued email. |
| `POST` | `/api/v1/emails/{id}/cancel` | Cancel a queued email. |
| `GET/POST` | `/api/v1/contactBooks` | List or create contact books. |
| `GET/PATCH/DELETE` | `/api/v1/contactBooks/{id}` | Manage a contact book. |
| `GET/POST` | `/api/v1/contactBooks/{id}/contacts` | List or upsert contacts. |
| `PATCH/PUT/DELETE` | `/api/v1/contactBooks/{id}/contacts/{contactId}` | Manage one contact. |
| `POST/DELETE` | `/api/v1/contactBooks/{id}/contacts/bulk` | Bulk add or remove contacts. |
| `GET/POST` | `/api/v1/campaigns` | List or create campaigns from a contact book. |
| `GET/DELETE` | `/api/v1/campaigns/{id}` | Retrieve or delete a campaign. |
| `POST` | `/api/v1/campaigns/{id}/schedule` | Schedule a draft campaign. |
| `GET` | `/api/v1/analytics/email-time-series` | Daily send, delivery, open, and click totals. |
| `GET` | `/api/v1/analytics/reputation-metrics` | Delivery and bounce rates. |

useSend features that SendMe does not implement yet return an explicit `400` or `501` instead of being silently ignored. This currently includes email templates and variables, attachments, CC/BCC recipients, campaign batching, and campaign pause/resume. See **API reference** in the dashboard for payloads, error codes, and rate limits.

## Webhooks

Create a webhook under **Webhooks** and select any of:

`email.sent`, `email.failed`, `email.opened`, `email.clicked`, `contact.created`, `campaign.completed`

Each POST is signed with the webhook secret:

```text
X-SendMe-Signature: v1=<hex hmac>
X-SendMe-Timestamp: <unix seconds>
X-SendMe-Event: <event name>
X-SendMe-Delivery: <delivery id>
```

The signed payload is `timestamp + "." + raw_request_body`, HMAC-SHA256 with the webhook secret. Reject stale timestamps and compare signatures in constant time. Failed deliveries are retried by the worker and visible in the delivery history.

## Tracking and unsubscribe

When tracking is enabled, SendMe rewrites links and injects a tracking pixel. Open and click endpoints are public and unauthenticated:

- `GET /api/t/o/{tracking_id}.gif`
- `GET /api/t/c/{tracking_id}?url=...&sig=...`
- `GET /api/u/{token}`

Unsubscribe links mark the contact as unsubscribed and render a small confirmation page. Campaign sends exclude unsubscribed contacts.

## Project layout

```text
.
├── server/
│   ├── cmd/server/              # API + worker entrypoint
│   ├── cmd/admin-cli/           # account administration CLI
│   └── internal/
│       ├── admin/               # owner creation and password reset
│       ├── api/                 # HTTP handlers, auth, middleware, tracking
│       ├── auth/                # JWT sessions and Argon2id passwords
│       ├── config/              # environment configuration
│       ├── crypto/              # AES-256-GCM secret sealing
│       ├── database/            # pgx pool and embedded migrations
│       ├── dkim/                # DKIM key generation
│       ├── mailer/              # SMTP relay client and direct-to-MX delivery
│       ├── queue/               # asynq client and rate limiting
│       ├── tracking/            # signed links and HTML rewriting
│       └── worker/              # email, campaign, and webhook tasks
├── web/
│   ├── app/                     # Next.js App Router pages and proxy
│   ├── components/              # dashboard UI
│   └── lib/                     # API client, types, utilities
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Production deployment

Generate a production env file with fresh secrets and start an isolated Compose project:

```bash
make init-prod APP_URL=https://mail.example.com
$EDITOR .env.prod   # review MAIL_HELO_HOST, MAIL_PUBLIC_IP, and port mappings
make prod-up
```

`make init-prod` creates a mode-`0600` `.env.prod`, sets `APP_ENV=production` and `COOKIE_SECURE=true`, and generates the JWT, encryption, signing, and PostgreSQL secrets. It refuses to overwrite an existing `.env.prod`.

`make prod-up` loads `.env.prod` and uses the `sendme-prod` Compose project, so its containers and volumes are separate from local development. Stop the local stack first if both use the same host ports. Use `make prod-down`, `make prod-logs`, `make prod-ps`, and `make prod-admin-cli ARGS='...'` to manage it.

### Production notes

- Put both services behind a TLS reverse proxy. Set `APP_URL` to the public HTTPS origin; the public API and all tracking/unsubscribe links use `<APP_URL>/api`. Set `TRUSTED_ORIGINS` if the dashboard uses another origin, and leave `COOKIE_SECURE` empty for automatic detection or set it to `true`.
- Generate fresh secrets. Never reuse the example values. Both `.env` and `.env.prod` are ignored by git and should stay private.
- `ENCRYPTION_KEY` must decode to exactly 32 bytes. Changing it makes existing SMTP passwords and direct-delivery DKIM keys unreadable.
- Back up PostgreSQL and the Redis append-only file. Redis holds queued sends and rate-limit counters; Postgres holds all durable state.
- Compose bakes `APP_URL` into the dashboard as `NEXT_PUBLIC_APP_URL` so API examples show the correct origin. If you build the web image manually, pass it yourself, for example `docker build --build-arg NEXT_PUBLIC_APP_URL=https://mail.example.com web`.
- For direct delivery, allow outbound TCP 25, set `MAIL_HELO_HOST` to a hostname with matching PTR, and publish SPF/DKIM/DMARC. A relay is the better choice when port 25 is blocked or you need managed IP reputation.
- When using an SMTP relay, SendMe trusts that relay. Use one that handles DKIM signing and outbound reputation.
- Rate limiting is per API key in Redis (120 requests/minute). Add a reverse-proxy limit for unauthenticated endpoints if the API is publicly reachable.

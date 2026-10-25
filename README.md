# SendMe

SendMe is a self-hosted email platform in the spirit of UseSend, built only with **Go, Next.js, PostgreSQL, and Redis**. It sends exclusively through **SMTP**, so any relay or mailbox provider that speaks SMTP can be used. There is no vendor integration, no service selector, and no third-party sending API.

Use it as a transactional email API, a campaign sender, a contact manager, or a full dashboard for several sending domains.

## Features

- **Multiple sending domains** — each domain stores its own SMTP host, port, TLS mode, authentication mode, credentials, and sender identity. Credentials are encrypted with AES-256-GCM.
- **Transactional API** — `POST /api/v1/emails` with a workspace API key, multiple recipients, scheduling, idempotency keys, tags-like custom headers, and open/click tracking.
- **Campaigns** — draft, preview, send immediately, schedule, cancel, and delete. Campaigns render per-contact template variables and add an unsubscribe footer automatically.
- **Contacts and audiences** — create, search, filter, paginate, edit, delete, import CSV, and manage audience membership in bulk.
- **Email log** — inspect rendered content, delivery status, attempts, tracking events, and retry failed messages.
- **Webhooks** — subscribe to delivery and engagement events, sign deliveries with HMAC-SHA256, send test events, and review delivery history.
- **API keys** — workspace-scoped bearer keys, shown in full once, with a per-key rate limit of 120 requests per minute.
- **Analytics** — workspace overview with send, delivery, open, and click metrics.
- **Single-binary backend** — the HTTP API and background worker (asynq + Redis) run in one Go process.

## Stack

| Layer | Technology |
| --- | --- |
| API and worker | Go 1.26, chi, pgx, asynq, go-mail |
| Dashboard | Next.js 16 App Router, React 19, Tailwind CSS v4, SWR |
| Database | PostgreSQL 18 |
| Queue and rate limits | Redis 7 |
| Auth | JWT in an HttpOnly cookie, Argon2id passwords |
| Secrets | AES-256-GCM for SMTP passwords |

## Quick start with Docker

Requirements: Docker with Compose, and `openssl`.

```bash
git clone <your-repo-url> sendme
cd sendme
make init          # creates .env with random JWT, encryption, and signing secrets
make up            # builds and starts Postgres, Redis, the API, and the dashboard
```

Open [http://localhost:3000](http://localhost:3000) and create the first account. The API is on [http://localhost:8080](http://localhost:8080); its health check is `GET /healthz`.

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

The frontend calls the API through the same-origin route `/api/proxy/*`. In development it forwards to `http://localhost:8080`; in Docker it forwards to `http://server:8080`. Override the target with `API_INTERNAL_URL`.

## Configuration

Copy `.env.example` to `.env` (or run `make init`) and adjust the values. The backend also reads `.env` from the repository root, `server/`, and one directory above.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_ENV` | `development` | Set to `production` to require explicit secrets. |
| `PORT` | `8080` | API listen port. |
| `APP_URL` | `http://localhost:3000` | Dashboard origin, used for CORS and trusted origins. |
| `API_PUBLIC_URL` | `http://localhost:8080` | Public API origin used in tracking and unsubscribe links. |
| `DATABASE_URL` | local `sendme` database | PostgreSQL connection string. |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string. |
| `JWT_SECRET` | development fallback | Signs session cookies. Required in production. |
| `ENCRYPTION_KEY` | derived in development | Base64-encoded 32-byte key for SMTP password encryption. Required in production. |
| `SIGNING_SECRET` | `JWT_SECRET` | Signs tracking links and unsubscribe tokens. |
| `SESSION_TTL` | `168h` | Session lifetime. |
| `COOKIE_SECURE` | auto from `API_PUBLIC_URL` | Force the `Secure` cookie flag. |
| `COOKIE_DOMAIN` | empty | Optional cookie domain. |
| `TRUSTED_ORIGINS` | `APP_URL` | Comma-separated extra CORS origins. |
| `WORKER_ENABLED` | `true` | Run the background worker inside the API process. |
| `WORKER_CONCURRENCY` | `10` | Worker concurrency. |
| `NEXT_PUBLIC_API_PUBLIC_URL` | `http://localhost:8080` | Public API origin shown in the dashboard and API reference. Baked in at web build time. |
| `API_INTERNAL_URL` | `http://localhost:8080` | Server-side proxy target used by Next.js. |

Generate secrets with:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 32   # SIGNING_SECRET
```

## Add a sending domain

1. Open **Domains → Add domain**.
2. Enter the domain name and sender identity (`From` name and address).
3. Enter the SMTP endpoint: host, port, security (`none`, `starttls`, or `tls`), auth (`none`, `plain`, or `login`), username, and password.
4. Save, choose a test recipient, and run the SMTP test. A domain becomes `active` only after a test email is delivered successfully.
5. Optionally use **Check DNS** to inspect MX, SPF, and DMARC records. DKIM is configured on the SMTP relay.

Only active domains can send email. The `From` address must belong to the selected domain. Reply-to, tracking, and unsubscribe behavior are configured per message or campaign.

## Send with the API

Create a key under **API keys**, then:

```bash
curl -X POST http://localhost:8080/api/v1/emails \
  -H "Authorization: Bearer sm_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: welcome-42" \
  -d '{
    "to": "customer@example.com",
    "domain": "example.com",
    "from": "Acme <hello@example.com>",
    "subject": "Welcome to Acme",
    "html": "<h1>Hello</h1><p>Your account is ready.</p>",
    "text": "Hello, your account is ready.",
    "track_opens": true,
    "track_clicks": true
  }'
```

The response contains the email `id` (and `ids` for batch sends). Other public endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/me` | Resolve the workspace for the current key. |
| `GET` | `/api/v1/domains` | List active domains. |
| `POST` | `/api/v1/emails` | Send or schedule up to 50 recipients. |
| `GET` | `/api/v1/emails` | List emails. |
| `GET` | `/api/v1/emails/{id}` | Retrieve one email, including events. |
| `POST` | `/api/v1/contacts` | Upsert a contact, optionally into an audience. |
| `GET` | `/api/v1/audiences` | List audiences. |

See **API reference** in the dashboard for request and response details, error codes, and rate limits.

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

- `GET /t/o/{tracking_id}.gif`
- `GET /t/c/{tracking_id}?url=...&sig=...`
- `GET /u/{token}`

Unsubscribe links mark the contact as unsubscribed and render a small confirmation page. Campaign sends exclude unsubscribed contacts.

## Project layout

```text
.
├── server/
│   ├── cmd/server/              # API + worker entrypoint
│   └── internal/
│       ├── api/                 # HTTP handlers, auth, middleware, tracking
│       ├── auth/                # JWT sessions and Argon2id passwords
│       ├── config/              # environment configuration
│       ├── crypto/              # AES-256-GCM secret sealing
│       ├── database/            # pgx pool and embedded migrations
│       ├── mailer/              # SMTP client
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

## Production notes

- Put both services behind a TLS reverse proxy. Set `APP_URL` and `API_PUBLIC_URL` to the HTTPS origins, set `TRUSTED_ORIGINS` if the dashboard uses another origin, and leave `COOKIE_SECURE` empty for automatic detection or set it to `true`.
- Generate fresh secrets. Never reuse the example values, and keep `.env` out of version control.
- `ENCRYPTION_KEY` must decode to exactly 32 bytes. Changing it makes existing SMTP passwords unreadable.
- Back up PostgreSQL and the Redis append-only file. Redis holds queued sends and rate-limit counters; Postgres holds all durable state.
- `NEXT_PUBLIC_API_PUBLIC_URL` is compiled into the dashboard. Set it before building the web image, for example with `API_PUBLIC_URL=https://mail.example.com docker compose build web`.
- The API trusts the SMTP server you configure. Use a relay that handles DKIM signing and outbound reputation.
- Rate limiting is per API key in Redis (120 requests/minute). Add a reverse-proxy limit for unauthenticated endpoints if the API is publicly reachable.

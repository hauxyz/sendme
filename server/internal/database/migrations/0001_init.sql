CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    id            uuid PRIMARY KEY,
    name          text NOT NULL,
    email         citext NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
    id         uuid PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         text NOT NULL DEFAULT 'owner',
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

CREATE TABLE domains (
    id                uuid PRIMARY KEY,
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name              text NOT NULL,
    from_name         text NOT NULL DEFAULT '',
    from_email        text NOT NULL,
    reply_to          text NOT NULL DEFAULT '',
    smtp_host         text NOT NULL,
    smtp_port         integer NOT NULL,
    smtp_security     text NOT NULL DEFAULT 'starttls' CHECK (smtp_security IN ('none', 'starttls', 'tls')),
    smtp_auth         text NOT NULL DEFAULT 'plain' CHECK (smtp_auth IN ('none', 'plain', 'login')),
    smtp_username     text NOT NULL DEFAULT '',
    smtp_password_enc text NOT NULL DEFAULT '',
    status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error')),
    last_error        text NOT NULL DEFAULT '',
    last_tested_at    timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE INDEX domains_workspace_idx ON domains (workspace_id, created_at DESC);

CREATE TABLE contacts (
    id           uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        citext NOT NULL,
    first_name   text NOT NULL DEFAULT '',
    last_name    text NOT NULL DEFAULT '',
    unsubscribed boolean NOT NULL DEFAULT false,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, email)
);

CREATE INDEX contacts_workspace_idx ON contacts (workspace_id, created_at DESC);
CREATE INDEX contacts_email_trgm_idx ON contacts USING gin (email gin_trgm_ops);
CREATE INDEX contacts_name_trgm_idx ON contacts USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

CREATE TABLE audiences (
    id           uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audiences_workspace_idx ON audiences (workspace_id, created_at DESC);

CREATE TABLE audience_members (
    audience_id uuid NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
    contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (audience_id, contact_id)
);

CREATE INDEX audience_members_contact_idx ON audience_members (contact_id);

CREATE TABLE campaigns (
    id            uuid PRIMARY KEY,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL,
    subject       text NOT NULL DEFAULT '',
    preview_text  text NOT NULL DEFAULT '',
    from_domain_id uuid REFERENCES domains(id) ON DELETE SET NULL,
    audience_id   uuid REFERENCES audiences(id) ON DELETE SET NULL,
    html          text NOT NULL DEFAULT '',
    status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'canceled', 'failed')),
    scheduled_at  timestamptz,
    started_at    timestamptz,
    completed_at  timestamptz,
    track_opens   boolean NOT NULL DEFAULT true,
    track_clicks  boolean NOT NULL DEFAULT true,
    total_recipients integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_workspace_idx ON campaigns (workspace_id, created_at DESC);
CREATE INDEX campaigns_status_idx ON campaigns (workspace_id, status);

CREATE TABLE api_keys (
    id           uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    prefix       text NOT NULL,
    key_hash     text NOT NULL UNIQUE,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_keys_workspace_idx ON api_keys (workspace_id, created_at DESC);

CREATE TABLE emails (
    id             uuid PRIMARY KEY,
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain_id      uuid REFERENCES domains(id) ON DELETE SET NULL,
    campaign_id    uuid REFERENCES campaigns(id) ON DELETE SET NULL,
    contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
    api_key_id     uuid REFERENCES api_keys(id) ON DELETE SET NULL,
    source         text NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'campaign', 'dashboard', 'test')),
    to_email       citext NOT NULL,
    to_name        text NOT NULL DEFAULT '',
    from_email     text NOT NULL,
    from_name      text NOT NULL DEFAULT '',
    reply_to       text NOT NULL DEFAULT '',
    subject        text NOT NULL,
    html           text NOT NULL DEFAULT '',
    text_content   text NOT NULL DEFAULT '',
    status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
    error          text NOT NULL DEFAULT '',
    attempts       integer NOT NULL DEFAULT 0,
    tracking_id    text NOT NULL UNIQUE,
    track_opens    boolean NOT NULL DEFAULT true,
    track_clicks   boolean NOT NULL DEFAULT true,
    opens          integer NOT NULL DEFAULT 0,
    clicks         integer NOT NULL DEFAULT 0,
    first_opened_at timestamptz,
    last_opened_at  timestamptz,
    unsubscribe_url text NOT NULL DEFAULT '',
    message_id      text NOT NULL DEFAULT '',
    headers         jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text,
    scheduled_at    timestamptz,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX emails_workspace_idx ON emails (workspace_id, created_at DESC);
CREATE INDEX emails_status_idx ON emails (workspace_id, status, created_at DESC);
CREATE INDEX emails_campaign_idx ON emails (campaign_id, created_at DESC);
CREATE INDEX emails_to_trgm_idx ON emails USING gin (to_email gin_trgm_ops);
CREATE INDEX emails_subject_trgm_idx ON emails USING gin (subject gin_trgm_ops);
CREATE UNIQUE INDEX emails_idempotency_idx ON emails (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX emails_campaign_contact_idx ON emails (campaign_id, contact_id) WHERE campaign_id IS NOT NULL;

CREATE TABLE email_events (
    id         bigserial PRIMARY KEY,
    email_id   uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    type       text NOT NULL,
    url        text NOT NULL DEFAULT '',
    user_agent text NOT NULL DEFAULT '',
    ip         text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_events_email_idx ON email_events (email_id, created_at DESC);
CREATE INDEX email_events_type_idx ON email_events (type, created_at DESC);

CREATE TABLE webhooks (
    id           uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    url          text NOT NULL,
    secret       text NOT NULL,
    events       jsonb NOT NULL DEFAULT '[]'::jsonb,
    enabled      boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhooks_workspace_idx ON webhooks (workspace_id, created_at DESC);

CREATE TABLE webhook_deliveries (
    id            uuid PRIMARY KEY,
    webhook_id    uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event         text NOT NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    status_code   integer,
    response_body text NOT NULL DEFAULT '',
    error         text NOT NULL DEFAULT '',
    attempts      integer NOT NULL DEFAULT 0,
    delivered_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, created_at DESC);

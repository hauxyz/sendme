export type WorkspaceMembership = {
  id: string;
  name: string;
  role: "owner" | "member";
};

export type Session = {
  user: { id: string; name: string; email: string; is_admin: boolean };
  workspace: { id: string; name: string };
  workspaces: WorkspaceMembership[];
};

export type Domain = {
  id: string;
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "none" | "starttls" | "tls";
  smtp_auth: "none" | "plain" | "login";
  smtp_username: string;
  has_password: boolean;
  delivery_mode: "direct" | "smtp";
  dkim_selector: string;
  status: "pending" | "active" | "error";
  last_error: string;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
  campaign_count?: number;
  email_count?: number;
};

export type DNSResult = {
  domain: string;
  checks: {
    type: string;
    name: string;
    found: boolean;
    values: string[] | null;
    description: string;
    recommended?: string;
  }[];
  checked_at: string;
  note: string;
};

export type AudienceRef = { id: string; name: string };

export type Contact = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  unsubscribed: boolean;
  metadata: Record<string, unknown>;
  audiences: AudienceRef[];
  created_at: string;
  updated_at: string;
};

export type Audience = {
  id: string;
  name: string;
  description: string;
  member_count: number;
  subscribed_count: number;
  created_at: string;
  updated_at: string;
};

export type EmailSummary = {
  id: string;
  to_email: string;
  to_name: string;
  from_email: string;
  from_name: string;
  subject: string;
  status: "queued" | "sending" | "sent" | "failed" | "canceled";
  error: string;
  source: "api" | "campaign" | "dashboard" | "test";
  domain_id: string | null;
  domain_name: string;
  campaign_id: string | null;
  campaign_name: string;
  contact_id: string | null;
  opens: number;
  clicks: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
};

export type EmailEvent = {
  id: number;
  type: string;
  url: string;
  user_agent: string;
  ip: string;
  created_at: string;
};

export type EmailDetail = EmailSummary & {
  html: string;
  text: string;
  reply_to: string;
  attempts: number;
  tracking_id: string;
  track_opens: boolean;
  track_clicks: boolean;
  first_opened_at: string | null;
  last_opened_at: string | null;
  message_id: string;
  headers: Record<string, string>;
  updated_at: string;
  events: EmailEvent[];
};

export type Campaign = {
  id: string;
  name: string;
  subject: string;
  preview_text: string;
  from_domain_id: string | null;
  from_email: string;
  from_name: string;
  reply_to: string;
  domain_name: string;
  audience_id: string | null;
  audience_name: string;
  html: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "canceled" | "failed";
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  queued_count: number;
  opened_count: number;
  clicked_count: number;
  created_at: string;
  updated_at: string;
};

export type APIKey = {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
};

export type Webhook = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type WebhookDelivery = {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  status_code: number | null;
  response_body: string;
  error: string;
  attempts: number;
  delivered_at: string | null;
  created_at: string;
};

export type Analytics = {
  days: number;
  totals: {
    sent: number;
    failed: number;
    opened: number;
    clicked: number;
    open_rate: number;
    click_rate: number;
    contacts: number;
    subscribers: number;
    active_campaigns: number;
  };
  series: {
    date: string;
    sent: number;
    failed: number;
    opened: number;
    clicked: number;
  }[];
  domains: {
    id: string;
    name: string;
    status: string;
    sent: number;
    opened: number;
    open_rate: number;
  }[];
  recent_emails: EmailSummary[];
  generated_at: string;
};

export type Paginated<T> = { total: number } & T;

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  workspaces: { id: string; name: string; role: "owner" | "member" }[];
};

export type AdminWorkspace = {
  id: string;
  name: string;
  created_at: string;
  owner: { id: string; name: string; email: string } | null;
  member_count: number;
  domain_count: number;
  email_count: number;
};

export type AdminMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  is_admin: boolean;
  created_at: string;
};

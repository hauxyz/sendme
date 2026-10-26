"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { PUBLIC_API_URL } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/code-block";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "send-email", label: "Send email" },
  { id: "idempotency", label: "Idempotency" },
  { id: "retrieve-emails", label: "Retrieve emails" },
  { id: "contacts", label: "Contacts" },
  { id: "audiences-domains", label: "Audiences & domains" },
  { id: "webhooks", label: "Webhooks" },
  { id: "errors", label: "Errors & limits" },
];

export default function DocsPage() {
  const sendEmail = `curl -X POST ${PUBLIC_API_URL}/api/v1/emails \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "Acme <hello@yourdomain.com>",
    "to": "customer@example.com",
    "subject": "Your receipt",
    "html": "<h1>Thanks for your order</h1>",
    "text": "Thanks for your order"
  }'`;

  const response = `{
  "id": "b0d7c4c5-68a4-4e31-9f2d-6d3b90e2f6a1",
  "ids": ["b0d7c4c5-68a4-4e31-9f2d-6d3b90e2f6a1"],
  "email": {
    "id": "b0d7c4c5-68a4-4e31-9f2d-6d3b90e2f6a1",
    "to_email": "customer@example.com",
    "subject": "Your receipt",
    "status": "queued",
    "domain_name": "yourdomain.com",
    "created_at": "2026-10-25T18:00:00Z"
  }
}`;

  const verify = `import crypto from "node:crypto";

// Use the raw request body string, before JSON parsing.
const timestamp = req.headers["x-sendme-timestamp"];
const signature = req.headers["x-sendme-signature"];
const expected =
  "v1=" +
  crypto
    .createHmac("sha256", process.env.SENDME_WEBHOOK_SECRET)
    .update(timestamp + "." + rawBody)
    .digest("hex");

const valid =
  signature.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

if (!valid) throw new Error("Invalid SendMe webhook signature");`;

  return (
    <div>
      <PageHeader
        title="API reference"
        description="Everything you need to send transactional email and receive engagement events from your SendMe workspace."
        actions={
          <Link href="/api-keys">
            <Button>
              <KeyRound className="size-4" />
              Manage API keys
            </Button>
          </Link>
        }
      />

      <div className="grid items-start gap-8 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-8 hidden xl:block">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            On this page
          </p>
          <nav className="space-y-0.5">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block rounded-md px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-300"
              >
                {section.label}
              </a>
            ))}
          </nav>
          <div className="mt-6 rounded-lg border border-[#26262b] bg-[#0f0f12] p-3.5">
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <ShieldCheck className="size-3.5 text-emerald-400" />
              REST · JSON · Bearer
            </div>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-zinc-600">
              {PUBLIC_API_URL}/api/v1
            </p>
          </div>
        </aside>

        <div className="min-w-0 space-y-12">
          <DocSection
            id="overview"
            title="Overview"
            description="SendMe sends transactional and campaign email through built-in direct delivery or the SMTP relays you configure. The public API is scoped to your workspace and uses your verified sending domains."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <DocFeature icon={Mail} title="Send email" text="Queue one or many recipients in a single request." />
              <DocFeature icon={ShieldCheck} title="Own your delivery" text="Send direct from Go or through your own SMTP infrastructure." />
              <DocFeature icon={Webhook} title="Webhooks" text="Receive signed delivery and engagement events." />
            </div>
            <div className="rounded-xl border border-[#26262b] bg-[#0b0b0e] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Base URL</p>
              <p className="mt-1.5 break-all font-mono text-[13px] text-zinc-300">{PUBLIC_API_URL}/api/v1</p>
            </div>
            <Callout tone="amber" icon={AlertTriangle}>
              At least one domain must be added and pass a delivery test before the API can send. Add a
              domain from <Link href="/domains" className="text-amber-200 underline underline-offset-2">Domains</Link>.
            </Callout>
          </DocSection>

          <DocSection
            id="authentication"
            title="Authentication"
            description="Create an API key in the dashboard and pass it as a Bearer token on every request."
          >
            <CodeBlock
              title="Authorization header"
              code={`Authorization: Bearer sm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
            />
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Keys inherit the permissions of your workspace. They are hashed before storage and are
              shown only once when created. Revoke a key from the{" "}
              <Link href="/api-keys" className="text-violet-300 underline underline-offset-2">
                API keys page
              </Link>
              .
            </p>
          </DocSection>

          <DocSection
            id="send-email"
            title="Send email"
            description="Queue a transactional email for immediate or scheduled delivery through one of your verified sending domains."
          >
            <Endpoint method="POST" path="/emails" />
            <CodeBlock title="cURL" code={sendEmail} />
            <h3 className="text-[13px] font-semibold text-zinc-200">Request body</h3>
            <ParamTable
              rows={[
                ["to", "string | string[]", "Yes", "One recipient, or up to 50 recipients."],
                ["subject", "string", "Yes", "Up to 300 characters."],
                ["html", "string", "One of html/text", "HTML body of the email."],
                ["text", "string", "One of html/text", "Plain-text fallback. Generated from HTML when omitted."],
                ["from", "string", "No", "Sender address or name + address. Must match the selected domain."],
                ["domain", "string", "No", "Domain name used to resolve the sending domain."],
                ["domain_id", "string", "No", "Sending domain UUID. Takes precedence over domain."],
                ["reply_to", "string", "No", "Reply-to address."],
                ["scheduled_at", "string", "No", "ISO 8601 timestamp. Omit to send immediately."],
                ["track_opens", "boolean", "No", "Defaults to true."],
                ["track_clicks", "boolean", "No", "Defaults to true."],
                ["headers", "object", "No", "Up to 25 custom string headers."],
              ]}
            />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              If no domain is specified, SendMe uses the sender address domain. When the workspace
              has exactly one active domain, that domain is used as a fallback.
            </p>
            <CodeBlock title="201 Created" code={response} />
            <Callout tone="zinc" icon={CheckCircle2}>
              Delivery is asynchronous. A <code className="text-zinc-400">queued</code> response means
              the message is in Redis; poll the email endpoint for final delivery status.
            </Callout>
          </DocSection>

          <DocSection
            id="idempotency"
            title="Idempotency"
            description="Prevent duplicate sends when a network error makes a successful request look like a failure."
          >
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Add an <code className="rounded border border-[#2a2a2f] bg-[#0b0b0e] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">Idempotency-Key</code>{" "}
              header to a single-recipient request. Repeated requests with the same key return the
              original email instead of queueing a duplicate. Keys are limited to 200 characters and
              are not supported for multi-recipient sends.
            </p>
            <CodeBlock
              title="Idempotent request"
              code={`curl -X POST ${PUBLIC_API_URL}/api/v1/emails \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Idempotency-Key: order-confirmation-10482" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"customer@example.com","subject":"Receipt","html":"<p>Thanks!</p>"}'`}
            />
          </DocSection>

          <DocSection
            id="retrieve-emails"
            title="Retrieve emails"
            description="Inspect delivery status, engagement counts and email content. Useful for webhook backfills and support tooling."
          >
            <Endpoint method="GET" path="/emails" />
            <ParamTable
              rows={[
                ["limit", "integer", "No", "Page size, 1–200. Defaults to 50."],
                ["offset", "integer", "No", "Number of records to skip."],
                ["status", "string", "No", "queued, sending, sent or failed."],
                ["source", "string", "No", "api, campaign, dashboard or test."],
                ["campaign_id", "string", "No", "Filter by campaign UUID."],
                ["search", "string", "No", "Search recipient address or subject."],
              ]}
            />
            <CodeBlock
              title="Response shape"
              code={`{
  "emails": [
    {
      "id": "...",
      "to_email": "customer@example.com",
      "subject": "Your receipt",
      "status": "sent",
      "opens": 1,
      "clicks": 0,
      "sent_at": "2026-10-25T18:00:03Z"
    }
  ],
  "total": 1
}`}
            />
            <Endpoint method="GET" path="/emails/{id}" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Returns the full email, including HTML, text, tracking settings, headers and the recent event timeline.
            </p>
          </DocSection>

          <DocSection
            id="contacts"
            title="Contacts"
            description="Create or update a contact and optionally add them to an audience. Contacts are matched by email within the workspace."
          >
            <Endpoint method="POST" path="/contacts" />
            <ParamTable
              rows={[
                ["email", "string", "Yes", "Unique contact email address."],
                ["first_name", "string", "No", "Up to 100 characters."],
                ["last_name", "string", "No", "Up to 100 characters."],
                ["unsubscribed", "boolean", "No", "Defaults to false. Existing values are overwritten on update."],
                ["metadata", "object", "No", "Arbitrary JSON metadata stored with the contact."],
                ["audience_id", "string", "No", "Add the contact to this audience."],
              ]}
            />
            <CodeBlock
              title="Upsert a contact"
              code={`curl -X POST ${PUBLIC_API_URL}/api/v1/contacts \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "customer@example.com",
    "first_name": "Alex",
    "last_name": "Nguyen",
    "audience_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "metadata": {"plan": "pro"}
  }'`}
            />
          </DocSection>

          <DocSection
            id="audiences-domains"
            title="Audiences & domains"
            description="Discover the audiences and sending domains available to the workspace."
          >
            <Endpoint method="GET" path="/audiences" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Returns each audience with <code className="text-zinc-400">member_count</code> and{" "}
              <code className="text-zinc-400">subscribed_count</code>.
            </p>
            <Endpoint method="GET" path="/domains" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Returns the sender identity and verification status for each domain. Only{" "}
              <code className="text-zinc-400">active</code> domains can send.
            </p>
            <Endpoint method="GET" path="/me" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Returns the workspace and API key metadata associated with the current token.
            </p>
          </DocSection>

          <DocSection
            id="webhooks"
            title="Webhooks"
            description="SendMe signs every webhook request with the endpoint secret so your server can reject forged payloads."
          >
            <div className="rounded-xl border border-[#26262b] bg-[#0b0b0e] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Headers</p>
              <div className="mt-3 space-y-2 font-mono text-[11px] text-zinc-400">
                <p><span className="text-zinc-500">X-SendMe-Event:</span> email.sent</p>
                <p><span className="text-zinc-500">X-SendMe-Delivery:</span> b0d7c4c5-…</p>
                <p><span className="text-zinc-500">X-SendMe-Timestamp:</span> 1792941600</p>
                <p className="break-all"><span className="text-zinc-500">X-SendMe-Signature:</span> v1=8f2c…</p>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-400">
              The signature is an HMAC-SHA256 of{" "}
              <code className="text-zinc-300">timestamp.payload</code>, using the webhook secret as
              the key. Compare it with the received signature using a constant-time comparison and
              reject stale timestamps.
            </p>
            <CodeBlock title="Verify a webhook (Node.js)" code={verify} />
            <h3 className="text-[13px] font-semibold text-zinc-200">Events</h3>
            <div className="flex flex-wrap gap-1.5">
              {[
                "email.sent",
                "email.failed",
                "email.opened",
                "email.clicked",
                "contact.created",
                "campaign.completed",
                "webhook.test",
              ].map((event) => (
                <span
                  key={event}
                  className="rounded-md border border-[#2a2a2f] bg-[#0b0b0e] px-2 py-0.5 font-mono text-[10px] text-zinc-400"
                >
                  {event}
                </span>
              ))}
            </div>
            <CodeBlock
              title="Payload envelope"
              code={`{
  "type": "email.opened",
  "created_at": "2026-10-25T18:04:12Z",
  "data": {
    "email_id": "…",
    "to_email": "customer@example.com",
    "subject": "Your receipt"
  }
}`}
            />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Failed deliveries are retried automatically with exponential backoff. Each attempt is
              recorded in the dashboard with the HTTP status, response body and error.
            </p>
          </DocSection>

          <DocSection
            id="errors"
            title="Errors & limits"
            description="Every error uses the same JSON envelope with a stable machine-readable code."
          >
            <CodeBlock
              title="Error response"
              code={`{
  "error": {
    "code": "domain_not_active",
    "message": "Test the delivery configuration for this domain before sending"
  }
}`}
            />
            <div className="overflow-hidden rounded-xl border border-[#26262b]">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#26262b] bg-[#0b0b0e] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1f1f24] text-zinc-500">
                  {[
                    ["400", "Invalid request body, validation error or unknown field."],
                    ["401", "Missing, invalid or revoked API key."],
                    ["409", "Conflict, such as a duplicate contact or locked campaign."],
                    ["422", "Domain not active, empty audience or sender/domain mismatch."],
                    ["429", "Rate limit exceeded. Retry after the Retry-After header."],
                    ["500", "Unexpected server error. Safe to retry idempotent requests."],
                  ].map(([status, meaning]) => (
                    <tr key={status}>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-400">{status}</td>
                      <td className="px-4 py-2.5">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout tone="zinc" icon={ShieldCheck}>
              API keys are limited to 120 requests per minute. Transient delivery failures are retried by
              the background worker with backoff before an email is marked failed.
            </Callout>
            <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-violet-500/15 bg-[linear-gradient(110deg,rgba(139,92,246,0.06),rgba(15,15,18,0)_65%)] p-5 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-[14px] font-semibold text-zinc-100">Ready to send?</h3>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Create an API key and make your first request.
                </p>
              </div>
              <Link href="/api-keys">
                <Button>
                  <BookOpen className="size-4" />
                  Create an API key
                  <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            </div>
          </DocSection>
        </div>
      </div>
    </div>
  );
}

function DocSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <div className="mb-4 border-b border-[#1e1e22] pb-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-700">#</span>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
        </div>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-zinc-500">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function DocFeature({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-[#26262b] bg-[#0f0f12] p-4">
      <div className="flex size-8 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
        <Icon className="size-3.5 text-violet-300" />
      </div>
      <p className="mt-3 text-[12px] font-medium text-zinc-200">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{text}</p>
    </div>
  );
}

function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#26262b] bg-[#0b0b0e] px-4 py-3">
      <Badge tone={method === "POST" ? "violet" : "sky"}>{method}</Badge>
      <code className="break-all font-mono text-[12px] text-zinc-300">
        <span className="text-zinc-600">{PUBLIC_API_URL}/api/v1</span>
        {path}
      </code>
    </div>
  );
}

function ParamTable({ rows }: { rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#26262b]">
      <table className="w-full min-w-[640px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-[#26262b] bg-[#0b0b0e] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
            <th className="px-4 py-2.5 font-medium">Field</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Required</th>
            <th className="px-4 py-2.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1f1f24]">
          {rows.map(([name, type, required, description]) => (
            <tr key={name}>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-zinc-300">{name}</td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10.5px] text-zinc-500">{type}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-zinc-500">{required}</td>
              <td className="px-4 py-2.5 leading-relaxed text-zinc-500">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({
  tone,
  icon: Icon,
  children,
}: {
  tone: "amber" | "zinc";
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-[12px] leading-relaxed",
        tone === "amber"
          ? "border-amber-500/20 bg-amber-500/[0.05] text-amber-200/70"
          : "border-[#26262b] bg-[#0b0b0e] text-zinc-500",
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "amber" ? "text-amber-400" : "text-zinc-600")} />
      <div>{children}</div>
    </div>
  );
}

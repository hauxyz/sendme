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
import { PUBLIC_APP_URL } from "@/lib/api";
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
  { id: "contact-books", label: "Contact books" },
  { id: "domains", label: "Domains" },
  { id: "campaigns", label: "Campaigns & analytics" },
  { id: "webhooks", label: "Webhooks" },
  { id: "errors", label: "Errors & limits" },
];

export default function DocsPage() {
  const sendEmail = `curl -X POST ${PUBLIC_APP_URL}/api/v1/emails \\
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
  "emailId": "b0d7c4c5-68a4-4e31-9f2d-6d3b90e2f6a1"
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
        description="Everything you need to send transactional email and receive engagement events. The public API follows the useSend API format and is available on this dashboard's origin."
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
              {PUBLIC_APP_URL}/api/v1
            </p>
          </div>
        </aside>

        <div className="min-w-0 space-y-12">
          <DocSection
            id="overview"
            title="Overview"
            description="SendMe sends transactional and campaign email through built-in direct delivery or the SMTP relays you configure. The public API is scoped to your workspace, follows the useSend API shape, and is proxied through Next.js at /api/v1."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <DocFeature icon={Mail} title="Send email" text="Queue one or many recipients in a single request." />
              <DocFeature icon={ShieldCheck} title="Own your delivery" text="Send direct from Go or through your own SMTP infrastructure." />
              <DocFeature icon={Webhook} title="Webhooks" text="Receive signed delivery and engagement events." />
            </div>
            <div className="rounded-xl border border-[#26262b] bg-[#0b0b0e] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Base URL</p>
              <p className="mt-1.5 break-all font-mono text-[13px] text-zinc-300">{PUBLIC_APP_URL}/api/v1</p>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                Requests are proxied by Next.js to the Go API. Use this origin for server-side and browser clients.
              </p>
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
                ["from", "string", "Yes", "Sender name and address. Must match the selected verified domain."],
                ["subject", "string", "Yes", "Up to 300 characters."],
                ["html", "string", "One of html/text", "HTML body of the email."],
                ["text", "string", "One of html/text", "Plain-text fallback."],
                ["replyTo", "string", "No", "Reply-to address."],
                ["scheduledAt", "string", "No", "ISO 8601 timestamp. Omit to send immediately."],
                ["trackOpens", "boolean", "No", "Defaults to true."],
                ["trackClicks", "boolean", "No", "Defaults to true."],
                ["headers", "object", "No", "Up to 25 custom string headers."],
                ["inReplyToId", "string", "No", "Adds an In-Reply-To header for threading."],
              ]}
            />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              SendMe resolves the sending domain from the <code className="text-zinc-400">from</code> address.
              The legacy <code className="text-zinc-400">domain</code>, <code className="text-zinc-400">domain_id</code>,{" "}
              <code className="text-zinc-400">reply_to</code> and <code className="text-zinc-400">scheduled_at</code> aliases are also accepted.
            </p>
            <CodeBlock title="200 OK" code={response} />
            <Callout tone="amber" icon={AlertTriangle}>
              Email templates, attachments, CC/BCC recipients and analytics endpoints are not implemented yet.
              SendMe accepts the core useSend fields above and returns a clear validation error for unsupported features.
            </Callout>
            <Callout tone="zinc" icon={CheckCircle2}>
              Delivery is asynchronous. An <code className="text-zinc-400">emailId</code> response means
              the message is in Redis; poll <code className="text-zinc-400">GET /emails/{"{emailId}"}</code> for final delivery status.
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
              original <code className="text-zinc-400">emailId</code> instead of queueing a duplicate. Keys are limited to 256 characters and
              are not supported for multi-recipient or batch sends.
            </p>
            <CodeBlock
              title="Idempotent request"
              code={`curl -X POST ${PUBLIC_APP_URL}/api/v1/emails \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Idempotency-Key: order-confirmation-10482" \\
  -H "Content-Type: application/json" \\
  -d '{"from":"Acme <hello@yourdomain.com>","to":"customer@example.com","subject":"Receipt","html":"<p>Thanks!</p>"}'`}
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
                ["page", "integer", "No", "Page number. Defaults to 1."],
                ["limit", "integer", "No", "Page size, 1–200. Defaults to 50."],
                ["startDate", "string", "No", "Only return emails created at or after this ISO 8601 timestamp."],
                ["endDate", "string", "No", "Only return emails created at or before this ISO 8601 timestamp."],
                ["domainId", "string", "No", "Filter by domain UUID. Repeat the parameter or use a comma-separated list."],
              ]}
            />
            <CodeBlock
              title="Response shape"
              code={`{
  "data": [
    {
      "id": "...",
      "to": "customer@example.com",
      "from": "Acme <hello@yourdomain.com>",
      "subject": "Your receipt",
      "latestStatus": "DELIVERED",
      "createdAt": "2026-10-25T18:00:00Z",
      "updatedAt": "2026-10-25T18:00:03Z"
    }
  ],
  "count": 1
}`}
            />
            <Endpoint method="GET" path="/emails/{emailId}" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Returns the full email with an <code className="text-zinc-400">emailEvents</code> timeline.
              Statuses use the useSend enum, for example <code className="text-zinc-400">QUEUED</code>,{" "}
              <code className="text-zinc-400">DELIVERED</code>, <code className="text-zinc-400">OPENED</code> and{" "}
              <code className="text-zinc-400">FAILED</code>.
            </p>
            <Endpoint method="PATCH" path="/emails/{emailId}" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Update <code className="text-zinc-400">scheduledAt</code> for a queued email.
            </p>
            <Endpoint method="POST" path="/emails/{emailId}/cancel" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Cancel a queued email before the worker sends it.
            </p>
            <Endpoint method="POST" path="/emails/batch" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Send up to 100 emails in one request. The response contains a{" "}
              <code className="text-zinc-400">data</code> array of <code className="text-zinc-400">emailId</code> values.
            </p>
          </DocSection>

          <DocSection
            id="contact-books"
            title="Contact books"
            description="The useSend API calls audiences “contact books”. Create a book, then add or upsert contacts in it by email."
          >
            <Endpoint method="GET" path="/contactBooks" />
            <Endpoint method="POST" path="/contactBooks" />
            <CodeBlock
              title="Create a contact book"
              code={`curl -X POST ${PUBLIC_APP_URL}/api/v1/contactBooks \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Customers"}'`}
            />
            <Endpoint method="POST" path="/contactBooks/{contactBookId}/contacts" />
            <ParamTable
              rows={[
                ["email", "string", "Yes", "Unique contact email address within the workspace."],
                ["firstName", "string", "No", "Up to 100 characters."],
                ["lastName", "string", "No", "Up to 100 characters."],
                ["subscribed", "boolean", "No", "Defaults to true."],
                ["properties", "object", "No", "String key/value metadata stored with the contact."],
              ]}
            />
            <CodeBlock
              title="Add a contact"
              code={`curl -X POST ${PUBLIC_APP_URL}/api/v1/contactBooks/{contactBookId}/contacts \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "customer@example.com",
    "firstName": "Alex",
    "lastName": "Nguyen",
    "properties": {"plan": "pro"}
  }'`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Endpoint method="GET" path="/contactBooks/{id}/contacts" />
              <Endpoint method="GET" path="/contactBooks/{id}/contacts/{contactId}" />
              <Endpoint method="PATCH" path="/contactBooks/{id}/contacts/{contactId}" />
              <Endpoint method="PUT" path="/contactBooks/{id}/contacts/{contactId}" />
              <Endpoint method="POST" path="/contactBooks/{id}/contacts/bulk" />
              <Endpoint method="DELETE" path="/contactBooks/{id}/contacts/bulk" />
            </div>
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Bulk add accepts up to 1,000 contacts. Bulk delete takes a{" "}
              <code className="text-zinc-400">contactIds</code> array.
            </p>
          </DocSection>

          <DocSection
            id="domains"
            title="Domains"
            description="List, create and remove sending domains. Domain verification and delivery testing remain available from the dashboard."
          >
            <Endpoint method="GET" path="/domains" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Returns an array of useSend-shaped domain objects with status, DKIM public key and suggested DNS records.
            </p>
            <Endpoint method="POST" path="/domains" />
            <CodeBlock
              title="Create a direct-delivery domain"
              code={`curl -X POST ${PUBLIC_APP_URL}/api/v1/domains \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"mail.example.com"}'`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Endpoint method="GET" path="/domains/{id}" />
              <Endpoint method="PUT" path="/domains/{id}/verify" />
              <Endpoint method="DELETE" path="/domains/{id}" />
              <Endpoint method="GET" path="/me" />
            </div>
            <p className="text-[12px] leading-relaxed text-zinc-500">
              API-created domains use direct delivery and default to{" "}
              <code className="text-zinc-400">noreply@your-domain</code>. Configure SMTP relays and run delivery tests from the dashboard.
            </p>
          </DocSection>

          <DocSection
            id="campaigns"
            title="Campaigns & analytics"
            description="Create a campaign from a contact book, then send immediately or schedule it. Campaign sending uses the same direct-delivery or SMTP relay configuration as transactional email."
          >
            <Endpoint method="GET" path="/campaigns" />
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Supports <code className="text-zinc-400">page</code>, <code className="text-zinc-400">search</code> and
              a useSend status filter: <code className="text-zinc-400">DRAFT</code>, <code className="text-zinc-400">SCHEDULED</code>,
              <code className="text-zinc-400">RUNNING</code>, <code className="text-zinc-400">PAUSED</code> or <code className="text-zinc-400">SENT</code>.
            </p>
            <Endpoint method="POST" path="/campaigns" />
            <CodeBlock
              title="Create and send a campaign"
              code={`curl -X POST ${PUBLIC_APP_URL}/api/v1/campaigns \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "October product update",
    "from": "Acme <hello@example.com>",
    "subject": "What is new this month",
    "contactBookId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "html": "<h1>October update</h1><p>...</p>",
    "sendNow": false,
    "scheduledAt": "2026-11-01T09:00:00Z"
  }'`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Endpoint method="GET" path="/campaigns/{id}" />
              <Endpoint method="DELETE" path="/campaigns/{id}" />
              <Endpoint method="POST" path="/campaigns/{id}/schedule" />
              <Endpoint method="POST" path="/campaigns/{id}/pause" />
              <Endpoint method="POST" path="/campaigns/{id}/resume" />
              <Endpoint method="GET" path="/analytics/email-time-series" />
              <Endpoint method="GET" path="/analytics/reputation-metrics" />
            </div>
            <Callout tone="amber" icon={AlertTriangle}>
              Campaign batching, pause and resume are not implemented. Pause and resume return
              <code className="text-zinc-400">501 NOT_IMPLEMENTED</code> rather than pretending to succeed.
            </Callout>
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Analytics accept an optional <code className="text-zinc-400">domainId</code>. Time-series supports
              <code className="text-zinc-400">days=7</code> or <code className="text-zinc-400">days=30</code>.
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
    "code": "BAD_REQUEST",
    "message": "Provide at least one recipient in the to field"
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
                    ["400", "Invalid request body, validation error or unsupported useSend feature."],
                    ["401", "Missing, invalid or revoked API key."],
                    ["409", "Conflict, such as a duplicate domain or contact book."],
                    ["422", "Sending domain is missing, inactive or does not match the from address."],
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
        <span className="text-zinc-600">{PUBLIC_APP_URL}/api/v1</span>
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

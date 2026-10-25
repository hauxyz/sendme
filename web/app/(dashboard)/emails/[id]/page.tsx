"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Code2,
  Eye,
  Link2,
  Mail,
  MousePointerClick,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import type { EmailDetail } from "@/lib/types";
import { cn, formatDate, formatRelative } from "@/lib/utils";
import { PageHeader, PageLoading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { EmailPreview } from "@/components/email-preview";

type Tab = "preview" | "html" | "activity";

export default function EmailDetailPage() {
  const params = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("preview");
  const [retrying, setRetrying] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<{ email: EmailDetail }>(
    `/emails/${params.id}`,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.email.status === "queued" || latest?.email.status === "sending" ? 3500 : 0,
    },
  );

  if (isLoading) return <PageLoading />;

  if (error || !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <Mail className="size-8 text-zinc-700" />
        <h1 className="mt-4 text-lg font-semibold">Email not found</h1>
        <p className="mt-1 text-sm text-zinc-500">This email may have been removed or never queued.</p>
        <Link href="/emails" className="mt-6">
          <Button variant="secondary">Back to emails</Button>
        </Link>
      </div>
    );
  }

  const email = data.email;
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "preview", label: "Preview", icon: Eye },
    { id: "html", label: "HTML", icon: Code2 },
    { id: "activity", label: "Activity", icon: Clock },
  ];

  const retry = async () => {
    setRetrying(true);
    try {
      await api(`/emails/${email.id}/retry`, { method: "POST" });
      toast.success("Email queued for another attempt");
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not retry the email");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link
            href="/emails"
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 transition hover:text-zinc-300"
          >
            <ArrowLeft className="size-3.5" />
            Emails
          </Link>
        }
        title={email.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={email.status} />
            <span className="text-zinc-500">to</span>
            <span className="text-zinc-300">{email.to_email}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-500">{formatDate(email.created_at, true)}</span>
          </span>
        }
        actions={
          <>
            {email.campaign_id ? (
              <Link href={`/campaigns/${email.campaign_id}`}>
                <Button variant="secondary">View campaign</Button>
              </Link>
            ) : null}
            {email.status === "failed" || email.status === "queued" ? (
              <Button variant="secondary" onClick={retry} loading={retrying}>
                <RotateCcw className="size-4" />
                Retry delivery
              </Button>
            ) : null}
          </>
        }
      />

      {email.error ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" />
          <div>
            <p className="text-[13px] font-medium text-rose-200">Delivery error</p>
            <p className="mt-1 break-words font-mono text-[11.5px] leading-relaxed text-rose-300/70">
              {email.error}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Metric icon={Send} label="Status" value={email.status === "sent" ? "Accepted by SMTP" : email.status} />
        <Metric icon={Eye} label="Opens" value={String(email.opens)} hint={email.first_opened_at ? formatRelative(email.first_opened_at) : "No opens yet"} />
        <Metric icon={MousePointerClick} label="Clicks" value={String(email.clicks)} hint={email.clicks > 0 ? "Tracked link clicks" : "No clicks yet"} />
        <Metric icon={Clock} label="Attempts" value={String(email.attempts)} hint={email.sent_at ? `Sent ${formatRelative(email.sent_at)}` : "Not sent yet"} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-1 border-b border-[#1e1e22] p-2.5">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                    tab === item.id
                      ? "bg-white/[0.07] text-zinc-100"
                      : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                  {item.id === "activity" && email.events.length > 0 ? (
                    <span className="ml-0.5 rounded bg-white/[0.07] px-1 text-[9px] text-zinc-400">
                      {email.events.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {tab === "preview" ? (
            <div className="p-4">
              <EmailPreview
                html={email.html || `<p style="color:#71717a">${email.text || "No HTML content"}</p>`}
                subject={email.subject}
                fromName={email.from_name}
                fromEmail={email.from_email}
                to={email.to_email}
                height={600}
              />
            </div>
          ) : null}

          {tab === "html" ? (
            <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-[12px] leading-relaxed text-zinc-400">
              {email.html || "No HTML content"}
            </pre>
          ) : null}

          {tab === "activity" ? <ActivityTimeline email={email} /> : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="border-b border-[#1e1e22] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">Delivery details</h2>
            </div>
            <dl className="divide-y divide-[#1b1b1f]">
              <Detail label="To" value={email.to_name ? `${email.to_name} <${email.to_email}>` : email.to_email} />
              <Detail label="From" value={email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email} />
              {email.reply_to ? <Detail label="Reply-to" value={email.reply_to} /> : null}
              <Detail label="Domain" value={email.domain_name || "Deleted domain"} />
              <Detail
                label="Source"
                value={
                  email.campaign_name ||
                  (email.source === "api" ? "REST API" : email.source === "dashboard" ? "Dashboard" : "SMTP test")
                }
              />
              <Detail label="Tracking ID" value={email.tracking_id} mono />
              {email.message_id ? <Detail label="Message-ID" value={email.message_id} mono /> : null}
              <Detail label="Queued" value={formatDate(email.created_at, true)} />
              {email.scheduled_at && !email.sent_at ? (
                <Detail label="Scheduled" value={formatDate(email.scheduled_at, true)} />
              ) : null}
              {email.sent_at ? <Detail label="Sent" value={formatDate(email.sent_at, true)} /> : null}
              <Detail
                label="Tracking"
                value={`${email.track_opens ? "Opens" : "Opens off"} · ${email.track_clicks ? "Clicks" : "Clicks off"}`}
              />
            </dl>
          </Card>

          {Object.keys(email.headers || {}).length > 0 ? (
            <Card>
              <div className="border-b border-[#1e1e22] px-5 py-4">
                <h2 className="text-sm font-semibold text-zinc-100">Custom headers</h2>
              </div>
              <dl className="divide-y divide-[#1b1b1f]">
                {Object.entries(email.headers).map(([key, value]) => (
                  <Detail key={key} label={key} value={String(value)} mono />
                ))}
              </dl>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[#232327] bg-[#0f0f12] px-4 py-3.5">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Icon className="size-3.5 text-zinc-600" />
        {label}
      </div>
      <p className="mt-2 truncate text-[15px] font-semibold capitalize text-zinc-100">{value}</p>
      {hint ? <p className="mt-1 truncate text-[10px] text-zinc-600">{hint}</p> : null}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-5 py-3">
      <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">{label}</dt>
      <dd
        className={cn(
          "mt-1 break-all text-[12px] leading-relaxed text-zinc-300",
          mono && "font-mono text-[11px] text-zinc-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const eventMeta: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  queued: { label: "Queued for delivery", icon: Clock, color: "text-amber-400 bg-amber-500/10" },
  sending: { label: "Connecting to SMTP", icon: Send, color: "text-violet-400 bg-violet-500/10" },
  sent: { label: "Accepted by SMTP server", icon: CheckCircle2, color: "text-emerald-400 bg-emerald-500/10" },
  failed: { label: "Delivery failed", icon: XCircle, color: "text-rose-400 bg-rose-500/10" },
  send_failed: { label: "SMTP attempt failed", icon: AlertTriangle, color: "text-amber-400 bg-amber-500/10" },
  opened: { label: "Email opened", icon: Eye, color: "text-sky-400 bg-sky-500/10" },
  clicked: { label: "Link clicked", icon: Link2, color: "text-violet-400 bg-violet-500/10" },
};

function ActivityTimeline({ email }: { email: EmailDetail }) {
  if (email.events.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <Clock className="size-6 text-zinc-700" />
        <p className="mt-3 text-sm font-medium text-zinc-300">No activity yet</p>
        <p className="mt-1 text-xs text-zinc-600">Events will appear as this email is processed.</p>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="relative space-y-5 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-[#27272c]">
        {email.events.map((event) => {
          const meta = eventMeta[event.type] || {
            label: event.type,
            icon: Clock,
            color: "text-zinc-400 bg-zinc-500/10",
          };
          const Icon = meta.icon;
          return (
            <div key={event.id} className="relative flex gap-3">
              <div
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-[#0f0f12]",
                  meta.color,
                )}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13px] font-medium text-zinc-200">{meta.label}</p>
                  <span className="text-[10px] text-zinc-600" title={formatDate(event.created_at, true)}>
                    {formatRelative(event.created_at)}
                  </span>
                </div>
                {event.url ? (
                  <p className="mt-1 truncate font-mono text-[10.5px] text-zinc-500" title={event.url}>
                    {event.type === "clicked" ? event.url : event.url}
                  </p>
                ) : null}
                {event.user_agent || event.ip ? (
                  <p className="mt-1 truncate text-[10px] text-zinc-600">
                    {[event.ip, event.user_agent].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

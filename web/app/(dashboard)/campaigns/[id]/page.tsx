"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Mail,
  Megaphone,
  MousePointerClick,
  Pencil,
  Send,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import { personalize } from "@/lib/email-templates";
import type { Audience, Campaign, EmailSummary } from "@/lib/types";
import {
  cn,
  formatDate,
  formatNumber,
  formatRelative,
  localDateTimeValue,
  percent,
  toISOStringOrUndefined,
} from "@/lib/utils";
import { EmptyState, PageHeader, PageLoading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/status-badge";
import { EmailPreview } from "@/components/email-preview";

type Tab = "preview" | "recipients";
const PAGE_SIZE = 25;

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("preview");
  const [offset, setOffset] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sending, setSending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<{ campaign: Campaign }>(
    `/campaigns/${params.id}`,
    fetcher,
    {
      refreshInterval: (latest) => {
        if (latest?.campaign.status === "sending") return 4000;
        if (latest?.campaign.status === "scheduled") return 10000;
        return 0;
      },
    },
  );

  const { data: audienceData } = useSWR<{ audiences: Audience[] }>("/audiences", fetcher);

  const emailsKey =
    tab === "recipients"
      ? `/emails?campaign_id=${params.id}&limit=${PAGE_SIZE}&offset=${offset}`
      : null;
  const {
    data: emailData,
    isLoading: emailsLoading,
    mutate: mutateEmails,
  } = useSWR<{ emails: EmailSummary[]; total: number }>(emailsKey, fetcher, {
    keepPreviousData: true,
    refreshInterval: (latest) =>
      latest?.emails.some((email) => email.status === "queued" || email.status === "sending")
        ? 4000
        : 0,
  });

  const campaign = data?.campaign;
  const audience = useMemo(
    () => audienceData?.audiences.find((item) => item.id === campaign?.audience_id),
    [audienceData, campaign?.audience_id],
  );

  if (isLoading) return <PageLoading />;

  if (error || !campaign) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <Megaphone className="size-8 text-zinc-700" />
        <h1 className="mt-4 text-lg font-semibold">Campaign not found</h1>
        <p className="mt-1 text-sm text-zinc-500">This campaign may have been deleted.</p>
        <Link href="/campaigns" className="mt-6">
          <Button variant="secondary">Back to campaigns</Button>
        </Link>
      </div>
    );
  }

  const openSend = () => {
    setScheduledAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setSendMode("now");
    setSendOpen(true);
  };

  const sendCampaign = async () => {
    if (sendMode === "later" && !scheduledAt) {
      toast.error("Choose a date and time for this campaign");
      return;
    }
    if (sendMode === "later") {
      const date = new Date(scheduledAt);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        toast.error("Choose a time in the future");
        return;
      }
    }
    setSending(true);
    try {
      await api(`/campaigns/${campaign.id}/send`, {
        method: "POST",
        body: {
          scheduled_at:
            sendMode === "later" ? toISOStringOrUndefined(scheduledAt) || "" : "",
        },
      });
      toast.success(sendMode === "now" ? "Campaign queued for delivery" : "Campaign scheduled");
      setSendOpen(false);
      await Promise.all([mutate(), mutateEmails()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the campaign");
    } finally {
      setSending(false);
    }
  };

  const cancelCampaign = async () => {
    setCanceling(true);
    try {
      await api(`/campaigns/${campaign.id}/cancel`, { method: "POST" });
      toast.success("Campaign canceled");
      setCancelOpen(false);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not cancel the campaign");
    } finally {
      setCanceling(false);
    }
  };

  const deleteCampaign = async () => {
    setDeleting(true);
    try {
      await api(`/campaigns/${campaign.id}`, { method: "DELETE" });
      toast.success("Campaign deleted");
      router.push("/campaigns");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the campaign");
      setDeleting(false);
    }
  };

  const recipients = campaign.total_recipients || audience?.subscribed_count || 0;
  const emails = emailData?.emails || [];
  const emailTotal = emailData?.total || 0;
  const processed = campaign.sent_count + campaign.failed_count;
  const progress = campaign.total_recipients > 0 ? (processed / campaign.total_recipients) * 100 : 0;
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "preview", label: "Preview", icon: Eye },
    { id: "recipients", label: "Recipients", icon: Users },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 transition hover:text-zinc-300"
          >
            <ArrowLeft className="size-3.5" />
            Campaigns
          </Link>
        }
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span className="text-zinc-300">{campaign.subject || "No subject yet"}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-500">Created {formatDate(campaign.created_at, true)}</span>
          </span>
        }
        actions={
          <>
            {campaign.status === "draft" ? (
              <Link href={`/campaigns/${campaign.id}/edit`}>
                <Button variant="secondary">
                  <Pencil className="size-4" />
                  Edit
                </Button>
              </Link>
            ) : null}
            {campaign.status === "draft" ? (
              <Button onClick={openSend} disabled={!campaign.from_domain_id || !campaign.audience_id}>
                <Send className="size-4" />
                Send campaign
              </Button>
            ) : null}
            {campaign.status === "scheduled" ? (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                <XCircle className="size-4" />
                Cancel schedule
              </Button>
            ) : null}
            {campaign.status === "draft" || campaign.status === "canceled" ? (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)} aria-label="Delete campaign">
                <Trash2 className="size-4 text-zinc-500" />
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      <StatusPanel campaign={campaign} progress={progress} onCancel={() => setCancelOpen(true)} onSend={openSend} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Users} label="Recipients" value={formatNumber(recipients)} hint={audience?.name || "Audience removed"} />
        <Metric
          icon={CheckCircle2}
          label="Delivered"
          value={formatNumber(campaign.sent_count)}
          hint={campaign.total_recipients > 0 ? `${percent((campaign.sent_count / campaign.total_recipients) * 100)} of audience` : "Not sent yet"}
        />
        <Metric
          icon={Eye}
          label="Opened"
          value={formatNumber(campaign.opened_count)}
          hint={campaign.sent_count > 0 ? `${percent((campaign.opened_count / campaign.sent_count) * 100)} open rate` : "No opens yet"}
        />
        <Metric
          icon={MousePointerClick}
          label="Clicked"
          value={formatNumber(campaign.clicked_count)}
          hint={campaign.sent_count > 0 ? `${percent((campaign.clicked_count / campaign.sent_count) * 100)} click rate` : "No clicks yet"}
        />
        <Metric
          icon={AlertTriangle}
          label="Failed"
          value={formatNumber(campaign.failed_count)}
          hint={campaign.queued_count > 0 ? `${formatNumber(campaign.queued_count)} still queued` : "No delivery failures"}
          danger={campaign.failed_count > 0}
        />
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
                  {item.id === "recipients" && emailTotal > 0 ? (
                    <span className="ml-0.5 rounded bg-white/[0.07] px-1 text-[9px] text-zinc-400">
                      {formatNumber(emailTotal)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {tab === "preview" ? (
            <div className="p-4">
              <EmailPreview
                html={personalize(campaign.html || "<p style='color:#a1a1aa'>This campaign has no content yet.</p>")}
                subject={campaign.subject}
                fromName={campaign.from_name}
                fromEmail={campaign.from_email}
                to={formatNumber(recipients) + " recipients"}
                height={620}
              />
            </div>
          ) : null}

          {tab === "recipients" ? (
            <RecipientsTable
              emails={emails}
              loading={emailsLoading}
              offset={offset}
              total={emailTotal}
              onOffset={setOffset}
            />
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="border-b border-[#1e1e22] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">Delivery details</h2>
            </div>
            <dl className="divide-y divide-[#1b1b1f]">
              <Detail
                label="From"
                value={
                  campaign.from_name
                    ? `${campaign.from_name} <${campaign.from_email}>`
                    : campaign.from_email || "No sender set"
                }
              />
              <Detail label="Domain" value={campaign.domain_name || "No domain selected"} />
              <Detail
                label="Audience"
                value={campaign.audience_name || "No audience selected"}
                href={campaign.audience_id ? `/contacts?audience=${campaign.audience_id}` : undefined}
              />
              <Detail label="Recipients" value={formatNumber(recipients)} />
              <Detail
                label="Tracking"
                value={`${campaign.track_opens ? "Opens on" : "Opens off"} · ${campaign.track_clicks ? "Clicks on" : "Clicks off"}`}
              />
              <Detail label="Created" value={formatDate(campaign.created_at, true)} />
              {campaign.scheduled_at ? (
                <Detail
                  label={campaign.started_at ? "Scheduled for" : "Status"}
                  value={formatDate(campaign.scheduled_at, true)}
                />
              ) : null}
              {campaign.started_at ? <Detail label="Started" value={formatDate(campaign.started_at, true)} /> : null}
              {campaign.completed_at ? <Detail label="Completed" value={formatDate(campaign.completed_at, true)} /> : null}
            </dl>
          </Card>

          {audience ? (
            <Card>
              <div className="border-b border-[#1e1e22] px-5 py-4">
                <h2 className="text-sm font-semibold text-zinc-100">Audience</h2>
              </div>
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
                    <Users className="size-4 text-violet-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-zinc-200">{audience.name}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {formatNumber(audience.subscribed_count)} subscribed ·{" "}
                      {formatNumber(audience.member_count)} total
                    </p>
                  </div>
                </div>
                {audience.description ? (
                  <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">{audience.description}</p>
                ) : null}
                <Link href={`/contacts?audience=${audience.id}`} className="mt-4 block">
                  <Button variant="secondary" size="sm" className="w-full">
                    Manage audience
                  </Button>
                </Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <Modal
        open={sendOpen}
        onClose={() => !sending && setSendOpen(false)}
        title="Send campaign"
        description={
          campaign.status === "draft"
            ? "Choose whether to deliver this campaign now or at a specific time."
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setSendOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={sendCampaign} loading={sending}>
              <Send className="size-4" />
              {sendMode === "now" ? "Send now" : "Schedule campaign"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSendMode("now")}
              className={cn(
                "rounded-lg border p-3.5 text-left transition",
                sendMode === "now"
                  ? "border-violet-500/40 bg-violet-500/[0.07]"
                  : "border-[#2a2a2f] bg-[#0b0b0e] hover:border-[#3a3a41]",
              )}
            >
              <Send className={cn("size-4", sendMode === "now" ? "text-violet-300" : "text-zinc-600")} />
              <p className="mt-2 text-[13px] font-medium text-zinc-200">Send now</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Queue immediately.</p>
            </button>
            <button
              type="button"
              onClick={() => setSendMode("later")}
              className={cn(
                "rounded-lg border p-3.5 text-left transition",
                sendMode === "later"
                  ? "border-violet-500/40 bg-violet-500/[0.07]"
                  : "border-[#2a2a2f] bg-[#0b0b0e] hover:border-[#3a3a41]",
              )}
            >
              <CalendarClock
                className={cn("size-4", sendMode === "later" ? "text-violet-300" : "text-zinc-600")}
              />
              <p className="mt-2 text-[13px] font-medium text-zinc-200">Schedule</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Pick a date and time.</p>
            </button>
          </div>

          {sendMode === "later" ? (
            <Field label="Send at" hint="Times are shown in your local timezone." htmlFor="send-at">
              <Input
                id="send-at"
                type="datetime-local"
                value={scheduledAt}
                min={localDateTimeValue()}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
              />
            </Field>
          ) : null}

          <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-4">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-500">Recipients</span>
              <span className="font-medium text-zinc-200">{formatNumber(recipients)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span className="text-zinc-500">Sender</span>
              <span className="max-w-[220px] truncate text-right text-zinc-300">
                {campaign.from_email}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span className="text-zinc-500">Audience</span>
              <span className="max-w-[220px] truncate text-right text-zinc-300">
                {campaign.audience_name}
              </span>
            </div>
          </div>

          {recipients === 0 ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
              <p className="text-[11.5px] leading-relaxed text-amber-200/70">
                This audience has no subscribed contacts. Add contacts before sending.
              </p>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-zinc-600">
            Email delivery starts within a few seconds. Once the first message is queued you cannot
            cancel this campaign. Unsubscribed contacts are skipped automatically.
          </p>
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => !canceling && setCancelOpen(false)}
        title="Cancel scheduled campaign?"
        description="The campaign will not be sent and can be deleted or kept as a record."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={canceling}>
              Keep scheduled
            </Button>
            <Button variant="danger" onClick={cancelCampaign} loading={canceling}>
              Cancel campaign
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          {campaign.name} is scheduled for{" "}
          <span className="text-zinc-200">{formatDate(campaign.scheduled_at, true)}</span>. Any
          queued recipient tasks will be stopped.
        </p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="Delete campaign?"
        description="This permanently removes the campaign draft and its settings."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteCampaign} loading={deleting}>
              Delete campaign
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Emails already delivered by this campaign are kept in your email history. This action
          cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function StatusPanel({
  campaign,
  progress,
  onCancel,
  onSend,
}: {
  campaign: Campaign;
  progress: number;
  onCancel: () => void;
  onSend: () => void;
}) {
  if (campaign.status === "draft") {
    return (
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-violet-300" />
          <div>
            <p className="text-[13px] font-medium text-violet-200">This campaign is a draft</p>
            <p className="mt-0.5 text-[12px] text-violet-200/50">
              Review the preview and recipients, then schedule or send it when you&apos;re ready.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={onSend} disabled={!campaign.from_domain_id || !campaign.audience_id}>
          <Send className="size-3.5" />
          Send campaign
        </Button>
      </div>
    );
  }

  if (campaign.status === "scheduled") {
    return (
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div>
            <p className="text-[13px] font-medium text-amber-200">Scheduled for {formatDate(campaign.scheduled_at, true)}</p>
            <p className="mt-0.5 text-[12px] text-amber-200/50">
              The campaign is queued and will start sending automatically.
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel schedule
        </Button>
      </div>
    );
  }

  if (campaign.status === "sending") {
    return (
      <div className="mb-5 rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-4 py-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Send className="mt-0.5 size-4 shrink-0 text-violet-300" />
            <div>
              <p className="text-[13px] font-medium text-violet-200">Sending now</p>
              <p className="mt-0.5 text-[12px] text-violet-200/50">
                {formatNumber(campaign.sent_count)} delivered ·{" "}
                {formatNumber(campaign.queued_count)} in queue ·{" "}
                {formatNumber(campaign.failed_count)} failed
              </p>
            </div>
          </div>
          <span className="text-[12px] tabular-nums text-violet-200/60">{Math.round(progress)}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-500"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      </div>
    );
  }

  if (campaign.status === "sent") {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-3.5">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <div>
          <p className="text-[13px] font-medium text-emerald-200">Campaign completed</p>
          <p className="mt-0.5 text-[12px] text-emerald-200/50">
            {formatNumber(campaign.sent_count)} emails delivered
            {campaign.completed_at ? ` · ${formatRelative(campaign.completed_at)}` : ""}
            {campaign.failed_count > 0 ? ` · ${formatNumber(campaign.failed_count)} failed` : ""}.
          </p>
        </div>
      </div>
    );
  }

  if (campaign.status === "canceled") {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#2a2a2f] bg-white/[0.02] px-4 py-3.5">
        <XCircle className="mt-0.5 size-4 shrink-0 text-zinc-500" />
        <div>
          <p className="text-[13px] font-medium text-zinc-300">Campaign canceled</p>
          <p className="mt-0.5 text-[12px] text-zinc-600">
            No further emails will be sent. You can delete this campaign if you no longer need it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] px-4 py-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" />
      <div>
        <p className="text-[13px] font-medium text-rose-200">Campaign failed</p>
        <p className="mt-0.5 text-[12px] text-rose-300/60">
          Sending stopped unexpectedly. Review the recipient delivery errors and create a new campaign.
        </p>
      </div>
    </div>
  );
}

function RecipientsTable({
  emails,
  loading,
  offset,
  total,
  onOffset,
}: {
  emails: EmailSummary[];
  loading: boolean;
  offset: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  if (loading && emails.length === 0) {
    return (
      <div className="space-y-1 p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-2 py-3">
            <div className="size-8 animate-pulse rounded-lg bg-white/[0.04]" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-white/[0.04]" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="No recipients yet"
        description="Recipient deliveries will appear here once this campaign starts sending."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left">
          <thead>
            <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
              <th className="px-5 py-3 font-medium">Recipient</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-center font-medium">Opens</th>
              <th className="px-4 py-3 text-center font-medium">Clicks</th>
              <th className="px-5 py-3 text-right font-medium">Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a1a1e]">
            {emails.map((email) => (
              <tr key={email.id} className="group transition hover:bg-white/[0.022]">
                <td className="px-5 py-3.5">
                  <Link href={`/emails/${email.id}`} className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
                      <Mail className="size-3.5 text-zinc-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-[230px] truncate text-[13px] font-medium text-zinc-200">
                        {email.to_name || email.to_email}
                      </p>
                      {email.to_name ? (
                        <p className="max-w-[230px] truncate text-[11px] text-zinc-600">{email.to_email}</p>
                      ) : null}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={email.status} />
                </td>
                <td className="px-4 py-3.5 text-center text-[12px] tabular-nums text-zinc-400">
                  {email.opens > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Eye className="size-3 text-zinc-600" /> {email.opens}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-center text-[12px] tabular-nums text-zinc-400">
                  {email.clicks > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick className="size-3 text-zinc-600" /> {email.clicks}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] text-zinc-500">
                  <span title={formatDate(email.sent_at || email.created_at, true)}>
                    {formatRelative(email.sent_at || email.created_at)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 ? (
        <div className="flex items-center justify-between border-t border-[#1e1e22] px-5 py-3">
          <p className="text-[11px] text-zinc-500">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {formatNumber(total)}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={offset === 0}
              onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => onOffset(offset + PAGE_SIZE)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  danger = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#232327] bg-[#0f0f12] px-4 py-3.5">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Icon className={cn("size-3.5", danger ? "text-rose-400" : "text-zinc-600")} />
        {label}
      </div>
      <p className="mt-2 truncate text-[17px] font-semibold tabular-nums text-zinc-100">{value}</p>
      <p className="mt-1 truncate text-[10px] text-zinc-600">{hint}</p>
    </div>
  );
}

function Detail({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="px-5 py-3">
      <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">{label}</dt>
      <dd className="mt-1 break-words text-[12px] leading-relaxed text-zinc-300">
        {href ? (
          <Link href={href} className="transition hover:text-violet-300">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

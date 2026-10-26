"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock,
  Eye,
  Mail,
  MousePointerClick,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";
import { transactionalTemplate } from "@/lib/email-templates";
import type { Domain, EmailDetail } from "@/lib/types";
import { toISOStringOrUndefined } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { RichEditor } from "@/components/rich-editor";
import { EmailPreview } from "@/components/email-preview";
import { cn } from "@/lib/utils";

export default function NewEmailPage() {
  const router = useRouter();
  const { session } = useSession();
  const { data, isLoading } = useSWR<{ domains: Domain[] }>("/domains", fetcher);
  const domains = useMemo(() => data?.domains || [], [data]);
  const activeDomains = useMemo(() => domains.filter((domain) => domain.status === "active"), [domains]);

  const [domainId, setDomainId] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("Welcome to Acme");
  const [html, setHtml] = useState(transactionalTemplate);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const effectiveDomainId = domainId || activeDomains[0]?.id || "";

  const selectedDomain = useMemo(
    () => domains.find((domain) => domain.id === effectiveDomainId),
    [domains, effectiveDomainId],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!effectiveDomainId) {
      setError("Add and test a sending domain before sending an email.");
      return;
    }
    if (!activeDomains.some((domain) => domain.id === effectiveDomainId)) {
      setError("This domain has not passed a delivery test yet.");
      return;
    }
    if (schedule && !scheduledAt) {
      setError("Choose a date and time for this email.");
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ email: EmailDetail }>("/emails", {
        method: "POST",
        body: {
          domain_id: effectiveDomainId,
          to: to.trim(),
          subject: subject.trim(),
          html,
          text,
          reply_to: replyTo.trim(),
          track_opens: trackOpens,
          track_clicks: trackClicks,
          scheduled_at: schedule ? toISOStringOrUndefined(scheduledAt) : undefined,
        },
      });
      toast.success(schedule ? "Email scheduled" : "Email queued for delivery");
      router.push(`/emails/${result.email.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not send the email.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
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
        title="Send an email"
        description="Deliver a transactional email through one of your verified sending domains."
        actions={
          <>
            <Link href="/emails" className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>
              Cancel
            </Link>
            <Button type="submit" form="email-form" loading={loading} disabled={!activeDomains.length}>
              <Send className="size-4" />
              {schedule ? "Schedule email" : "Send email"}
            </Button>
          </>
        }
      />

      {!isLoading && activeDomains.length === 0 ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">No verified sending domain</p>
              <p className="mt-1 text-[13px] text-amber-200/60">
                Add a sending domain and run a test before sending.
              </p>
            </div>
          </div>
          <Link href="/domains">
            <Button size="sm" variant="secondary">
              Add domain
            </Button>
          </Link>
        </div>
      ) : null}

      <form id="email-form" onSubmit={submit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_450px]">
        <div className="space-y-5">
          <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
            <div className="border-b border-[#1e1e22] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">Message</h2>
              <p className="mt-1 text-xs text-zinc-500">The from address is managed by your domain.</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From domain" htmlFor="domain">
                  <Select
                    id="domain"
                    value={effectiveDomainId}
                    onChange={(event) => setDomainId(event.target.value)}
                    required
                  >
                    <option value="">Select a domain</option>
                    {domains.map((domain) => (
                      <option key={domain.id} value={domain.id} disabled={domain.status !== "active"}>
                        {domain.name}
                        {domain.status !== "active" ? " — not verified" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Recipient" htmlFor="to">
                  <Input
                    id="to"
                    type="email"
                    placeholder="customer@example.com"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    required
                  />
                </Field>
              </div>
              <Field label="Subject" htmlFor="subject">
                <Input
                  id="subject"
                  placeholder="Your subject line"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  required
                  maxLength={300}
                />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
            <div className="flex items-center justify-between border-b border-[#1e1e22] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Content</h2>
                <p className="mt-1 text-xs text-zinc-500">Design or paste the HTML for your email.</p>
              </div>
              <button
                type="button"
                onClick={() => setHtml(transactionalTemplate)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#2a2a2f] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-[#3a3a41] hover:text-zinc-200"
              >
                <Sparkles className="size-3" />
                Reset template
              </button>
            </div>
            <div className="p-5">
              <RichEditor value={html} onChange={setHtml} placeholder="Write your transactional email…" />
            </div>
          </div>

          <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
            <button
              type="button"
              onClick={() => setAdvanced((open) => !open)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-2.5">
                <Settings2 className="size-4 text-zinc-500" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">Delivery options</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">Reply-to, tracking, schedule and text fallback.</p>
                </div>
              </div>
              <ChevronDown className={cn("size-4 text-zinc-600 transition", advanced && "rotate-180")} />
            </button>
            {advanced ? (
              <div className="animate-fade-in space-y-5 border-t border-[#1e1e22] p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Reply-to" hint="Optional. Replies will go to this address." htmlFor="reply-to">
                    <Input
                      id="reply-to"
                      type="email"
                      placeholder={session?.user.email}
                      value={replyTo}
                      onChange={(event) => setReplyTo(event.target.value)}
                    />
                  </Field>
                  <Field label="Plain text fallback" hint="Optional. Generated from HTML when empty." htmlFor="text">
                    <Textarea
                      id="text"
                      rows={3}
                      placeholder="Plain text version…"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3.5">
                    <Switch
                      checked={trackOpens}
                      onChange={setTrackOpens}
                      label="Track opens"
                      description="Add an invisible pixel to HTML emails."
                    />
                  </div>
                  <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3.5">
                    <Switch
                      checked={trackClicks}
                      onChange={setTrackClicks}
                      label="Track clicks"
                      description="Wrap links with a signed redirect."
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3.5">
                  <Switch
                    checked={schedule}
                    onChange={setSchedule}
                    label="Schedule for later"
                    description="Queue the email to send at a specific time."
                  />
                  {schedule ? (
                    <div className="mt-4">
                      <Field label="Send at" htmlFor="schedule">
                        <div className="relative">
                          <Clock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                          <Input
                            id="schedule"
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(event) => setScheduledAt(event.target.value)}
                            className="pl-9"
                            required
                          />
                        </div>
                      </Field>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 xl:sticky xl:top-8">
          <EmailPreview
            html={html}
            subject={subject}
            fromName={selectedDomain?.from_name}
            fromEmail={selectedDomain?.from_email}
            to={to}
            height={500}
          />
          <div className="rounded-xl border border-[#232327] bg-[#0f0f12] p-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-600">Sending as</p>
            {selectedDomain ? (
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-violet-500/10">
                  <Mail className="size-4 text-violet-300" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-zinc-200">
                    {selectedDomain.from_name || selectedDomain.from_email}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">{selectedDomain.from_email}</p>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-zinc-500">Select a verified domain to send.</p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#1e1e22] pt-3 text-[11px]">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Eye className={cn("size-3", trackOpens ? "text-emerald-400" : "text-zinc-700")} />
                Opens {trackOpens ? "tracked" : "off"}
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500">
                <MousePointerClick className={cn("size-3", trackClicks ? "text-emerald-400" : "text-zinc-700")} />
                Clicks {trackClicks ? "tracked" : "off"}
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

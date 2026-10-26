"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Eye,
  LayoutTemplate,
  Mail,
  MousePointerClick,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import { campaignTemplates, personalize } from "@/lib/email-templates";
import type { Audience, Campaign, Domain } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { RichEditor } from "@/components/rich-editor";
import { EmailPreview } from "@/components/email-preview";

type CampaignFormProps = {
  campaign?: Campaign;
};

export function CampaignForm({ campaign }: CampaignFormProps) {
  const router = useRouter();
  const editing = Boolean(campaign);
  const { data: domainData, isLoading: domainsLoading } = useSWR<{ domains: Domain[] }>("/domains", fetcher);
  const { data: audienceData, isLoading: audiencesLoading } = useSWR<{ audiences: Audience[] }>(
    "/audiences",
    fetcher,
  );
  const domains = useMemo(() => domainData?.domains || [], [domainData]);
  const audiences = useMemo(() => audienceData?.audiences || [], [audienceData]);
  const activeDomains = useMemo(() => domains.filter((domain) => domain.status === "active"), [domains]);

  const [name, setName] = useState(campaign?.name || "");
  const [subject, setSubject] = useState(campaign?.subject || "");
  const [previewText, setPreviewText] = useState(campaign?.preview_text || "");
  const [domainId, setDomainId] = useState(campaign?.from_domain_id || "");
  const [audienceId, setAudienceId] = useState(campaign?.audience_id || "");
  const [html, setHtml] = useState(campaign?.html || campaignTemplates[0].html);
  const [trackOpens, setTrackOpens] = useState(campaign?.track_opens ?? true);
  const [trackClicks, setTrackClicks] = useState(campaign?.track_clicks ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const effectiveDomainId = domainId || activeDomains[0]?.id || "";
  const effectiveAudienceId = audienceId || audiences[0]?.id || "";
  const selectedDomain = useMemo(
    () => domains.find((domain) => domain.id === effectiveDomainId),
    [domains, effectiveDomainId],
  );
  const selectedAudience = useMemo(
    () => audiences.find((audience) => audience.id === effectiveAudienceId),
    [audiences, effectiveAudienceId],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!effectiveDomainId) {
      setError("Choose a sending domain for this campaign.");
      return;
    }
    if (!activeDomains.some((domain) => domain.id === effectiveDomainId)) {
      setError("The selected domain has not passed a delivery test yet.");
      return;
    }
    if (!effectiveAudienceId) {
      setError("Choose the audience you want to send this campaign to.");
      return;
    }
    if (!subject.trim()) {
      setError("Add a subject line before saving this campaign.");
      return;
    }
    if (!html.trim()) {
      setError("Add some email content before saving this campaign.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        subject: subject.trim(),
        preview_text: previewText.trim(),
        from_domain_id: effectiveDomainId,
        audience_id: effectiveAudienceId,
        html,
        track_opens: trackOpens,
        track_clicks: trackClicks,
      };

      if (campaign) {
        await api(`/campaigns/${campaign.id}`, { method: "PATCH", body: payload });
        toast.success("Campaign saved");
      } else {
        const result = await api<{ campaign: Campaign }>("/campaigns", {
          method: "POST",
          body: payload,
        });
        toast.success("Campaign created as a draft");
        router.push(`/campaigns/${result.campaign.id}`);
        return;
      }
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not save the campaign.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link
            href={campaign ? `/campaigns/${campaign.id}` : "/campaigns"}
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 transition hover:text-zinc-300"
          >
            <ArrowLeft className="size-3.5" />
            {campaign ? campaign.name : "Campaigns"}
          </Link>
        }
        title={editing ? "Edit campaign" : "New campaign"}
        description="Write once and send to an audience through one of your verified sending domains."
        actions={
          <>
            <Link
              href={campaign ? `/campaigns/${campaign.id}` : "/campaigns"}
              className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}
            >
              Cancel
            </Link>
            <Button type="submit" form="campaign-form" loading={saving}>
              {editing ? (
                <>
                  <Check className="size-4" />
                  Save changes
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Create draft
                </>
              )}
            </Button>
          </>
        }
      />

      {!domainsLoading && activeDomains.length === 0 ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">No verified sending domain</p>
              <p className="mt-1 text-[13px] text-amber-200/60">
                Add a sending domain and run a test before scheduling this campaign.
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

      {!audiencesLoading && audiences.length === 0 ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">No audience yet</p>
              <p className="mt-1 text-[13px] text-amber-200/60">
                Add contacts to an audience before this campaign can be sent.
              </p>
            </div>
          </div>
          <Link href="/contacts">
            <Button size="sm" variant="secondary">
              Manage contacts
            </Button>
          </Link>
        </div>
      ) : null}

      <form id="campaign-form" onSubmit={submit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="space-y-5">
          <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
            <div className="border-b border-[#1e1e22] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">Campaign details</h2>
              <p className="mt-1 text-xs text-zinc-500">Name your campaign and write the subject line.</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Internal name" hint="Only visible in your dashboard." htmlFor="campaign-name">
                  <Input
                    id="campaign-name"
                    placeholder="October product update"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={160}
                  />
                </Field>
                <Field label="Preview text" hint="Shown in the inbox after the subject." htmlFor="preview-text">
                  <Input
                    id="preview-text"
                    placeholder="A new chapter for your team…"
                    value={previewText}
                    onChange={(event) => setPreviewText(event.target.value)}
                    maxLength={300}
                  />
                </Field>
              </div>
              <Field label="Subject" htmlFor="campaign-subject">
                <Input
                  id="campaign-subject"
                  placeholder="Something worth opening"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  required
                  maxLength={300}
                />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e1e22] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Email content</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Design your email with the visual editor or paste your own HTML.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHtml(campaignTemplates[0].html)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#2a2a2f] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-[#3a3a41] hover:text-zinc-200"
              >
                <Sparkles className="size-3" />
                Reset template
              </button>
            </div>

            <div className="border-b border-[#1e1e22] p-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">
                <LayoutTemplate className="size-3" />
                Start from a template
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {campaignTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setHtml(template.html)}
                    className={cn(
                      "group rounded-lg border p-3 text-left transition",
                      html === template.html
                        ? "border-violet-500/30 bg-violet-500/[0.06]"
                        : "border-[#26262b] bg-[#0b0b0e] hover:border-[#3a3a41] hover:bg-white/[0.025]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[12px] font-medium",
                          html === template.html ? "text-violet-200" : "text-zinc-300",
                        )}
                      >
                        {template.name}
                      </span>
                      {html === template.html ? <Check className="size-3 text-violet-400" /> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-600">
                      {template.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5">
              <RichEditor value={html} onChange={setHtml} placeholder="Write your campaign…" />
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600">
                <span>Personalize with</span>
                {["{{first_name}}", "{{last_name}}", "{{email}}", "{{unsubscribe_url}}"].map((token) => (
                  <code
                    key={token}
                    className="rounded border border-[#2a2a2f] bg-[#0b0b0e] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                  >
                    {token}
                  </code>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
            <div className="border-b border-[#1e1e22] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">Sender & audience</h2>
              <p className="mt-1 text-xs text-zinc-500">Who this email comes from and who receives it.</p>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Sending domain" htmlFor="campaign-domain">
                <Select
                  id="campaign-domain"
                  value={effectiveDomainId}
                  onChange={(event) => setDomainId(event.target.value)}
                  required
                >
                  <option value="">Select a verified domain</option>
                  {domains.map((domain) => (
                    <option key={domain.id} value={domain.id} disabled={domain.status !== "active"}>
                      {domain.name}
                      {domain.status !== "active" ? " — not verified" : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              {selectedDomain ? (
                <div className="flex items-center gap-3 rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10">
                    <Mail className="size-3.5 text-violet-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-zinc-200">
                      {selectedDomain.from_name || selectedDomain.from_email}
                    </p>
                    <p className="truncate text-[10.5px] text-zinc-500">{selectedDomain.from_email}</p>
                  </div>
                </div>
              ) : null}

              <Field label="Audience" htmlFor="campaign-audience">
                <Select
                  id="campaign-audience"
                  value={effectiveAudienceId}
                  onChange={(event) => setAudienceId(event.target.value)}
                  required
                >
                  <option value="">Select an audience</option>
                  {audiences.map((audience) => (
                    <option key={audience.id} value={audience.id}>
                      {audience.name} — {formatNumber(audience.subscribed_count)} subscribed
                    </option>
                  ))}
                </Select>
              </Field>

              {selectedAudience ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3">
                  <Users className="mt-0.5 size-3.5 shrink-0 text-zinc-600" />
                  <div>
                    <p className="text-[12px] font-medium text-zinc-300">
                      {formatNumber(selectedAudience.subscribed_count)} recipients
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-zinc-600">
                      {selectedAudience.member_count !== selectedAudience.subscribed_count
                        ? `${formatNumber(selectedAudience.member_count - selectedAudience.subscribed_count)} unsubscribed contacts will be skipped.`
                        : "Every contact in this audience is subscribed."}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[#232327] bg-[#0f0f12] p-5">
            <h2 className="text-sm font-semibold text-zinc-100">Tracking</h2>
            <p className="mb-4 mt-1 text-xs text-zinc-500">
              Engagement is tracked per recipient using first-party links.
            </p>
            <div className="space-y-3">
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

          <EmailPreview
            html={personalize(html)}
            subject={subject || "Your subject line preview"}
            fromName={selectedDomain?.from_name}
            fromEmail={selectedDomain?.from_email}
            to={selectedAudience ? `${formatNumber(selectedAudience.subscribed_count)} contacts` : "your audience"}
            height={440}
          />

          <div className="flex items-start gap-2 rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-600">
            <Send className="mt-0.5 size-3.5 shrink-0 text-zinc-700" />
            Campaigns are saved as drafts. You&apos;ll choose when to send after reviewing the final campaign.
          </div>
        </div>
      </form>
    </div>
  );
}

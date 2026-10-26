"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  Globe,
  Mail,
  Megaphone,
  MousePointerClick,
  Plus,
  Send,
  Users,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Analytics, Domain } from "@/lib/types";
import { cn, formatNumber, formatRelative, percent } from "@/lib/utils";
import { PageHeader, PageLoading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { EmailChart } from "@/components/email-chart";
import { StatusBadge } from "@/components/status-badge";

export default function DashboardPage() {
  const { session } = useSession();
  const [days, setDays] = useState(14);
  const { data, isLoading } = useSWR<Analytics>(`/analytics?days=${days}`, fetcher, {
    keepPreviousData: true,
    refreshInterval: 10000,
  });
  const { data: domainData } = useSWR<{ domains: Domain[] }>("/domains", fetcher);

  if (isLoading || !data) return <PageLoading />;

  const domains = domainData?.domains || [];
  const firstName = session?.user.name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const setupSteps = [
    { label: "Add a sending domain", done: domains.length > 0, href: "/domains" },
    { label: "Test your delivery setup", done: domains.some((domain) => domain.status === "active"), href: "/domains" },
    { label: "Add your first contacts", done: data.totals.contacts > 0, href: "/contacts" },
    { label: "Send an email", done: data.totals.sent > 0, href: "/emails/new" },
  ];
  const doneSteps = setupSteps.filter((step) => step.done).length;
  const setupComplete = doneSteps === setupSteps.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description="Here's what's happening with your email infrastructure."
        actions={
          <>
            <Link href="/emails/new">
              <Button variant="secondary">
                <Mail className="size-4" />
                Send email
              </Button>
            </Link>
            <Link href="/campaigns/new">
              <Button>
                <Megaphone className="size-4" />
                New campaign
              </Button>
            </Link>
          </>
        }
      />

      {!setupComplete ? (
        <div className="overflow-hidden rounded-xl border border-violet-500/15 bg-[linear-gradient(120deg,rgba(139,92,246,0.075),rgba(15,15,18,0.4)_55%)]">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <div className="flex items-center gap-2 text-xs font-medium text-violet-300">
                <span className="flex size-5 items-center justify-center rounded-full bg-violet-500/15">
                  <Check className="size-3" />
                </span>
                Getting started · {doneSteps} of {setupSteps.length}
              </div>
              <h2 className="mt-3 text-[15px] font-semibold text-zinc-100">
                {doneSteps === 0 ? "Connect a delivery method and start sending" : "Keep setting up your workspace"}
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                SendMe never routes mail through a third-party sending API. Use built-in direct
                delivery or connect your own SMTP relay.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:min-w-[310px]">
              {setupSteps.map((step) => (
                <Link
                  key={step.label}
                  href={step.href}
                  className="flex items-center gap-2.5 rounded-lg border border-white/[0.055] bg-black/20 px-3 py-2 text-[12px] text-zinc-300 outline-none transition hover:border-violet-500/20 hover:bg-violet-500/[0.04] focus-visible:ring-2 focus-visible:ring-violet-500/50"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      step.done
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-zinc-700 text-transparent",
                    )}
                  >
                    <Check className="size-2.5" />
                  </span>
                  <span className={cn(step.done && "text-zinc-500 line-through")}>{step.label}</span>
                  <ArrowRight className="ml-auto size-3 text-zinc-700" />
                </Link>
              ))}
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="Workspace setup progress"
            aria-valuemin={0}
            aria-valuemax={setupSteps.length}
            aria-valuenow={doneSteps}
            className="h-0.5 w-full bg-white/[0.04]"
          >
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-500"
              style={{ width: `${(doneSteps / setupSteps.length) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Emails sent"
          value={formatNumber(data.totals.sent)}
          hint={`${formatNumber(data.totals.failed)} failed · last ${days} days`}
          icon={Send}
          accent="violet"
        />
        <StatCard
          label="Open rate"
          value={percent(data.totals.open_rate)}
          hint={`${formatNumber(data.totals.opened)} unique opens`}
          icon={Eye}
          accent="mint"
        />
        <StatCard
          label="Click rate"
          value={percent(data.totals.click_rate)}
          hint={`${formatNumber(data.totals.clicked)} unique clicks`}
          icon={MousePointerClick}
          accent="sky"
        />
        <StatCard
          label="Contacts"
          value={formatNumber(data.totals.contacts)}
          hint={`${formatNumber(data.totals.subscribers)} subscribed`}
          icon={Users}
          accent="amber"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e1e22] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Sending activity</h2>
              <p className="mt-1 text-xs text-zinc-500">Emails sent and opened over time.</p>
            </div>
            <div
              className="flex items-center rounded-lg border border-[#2a2a2f] bg-[#0a0a0d] p-0.5"
              role="group"
              aria-label="Sending activity period"
            >
              {[7, 14, 30].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={days === value}
                  onClick={() => setDays(value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-violet-500/50",
                    days === value ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-300",
                  )}
                >
                  {value}d
                </button>
              ))}
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <EmailChart data={data.series} />
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Domain health"
            description="Delivery setups at a glance."
            action={
              <Link href="/domains">
                <Button variant="ghost" size="sm">
                  Manage
                  <ArrowUpRight className="size-3" />
                </Button>
              </Link>
            }
          />
          <div className="flex-1 p-3">
            {domains.length === 0 ? (
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
                <div className="flex size-10 items-center justify-center rounded-lg border border-[#2a2a2f] bg-white/[0.03]">
                  <Globe className="size-4 text-zinc-500" />
                </div>
                <p className="mt-3 text-[13px] font-medium text-zinc-300">No domains yet</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                  Add a sending domain to start.
                </p>
                <Link href="/domains" className="mt-4">
                  <Button size="sm" variant="secondary">
                    <Plus className="size-3.5" />
                    Add domain
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {domains.slice(0, 5).map((domain) => {
                  const stats = data.domains.find((item) => item.id === domain.id);
                  return (
                    <Link
                      key={domain.id}
                      href="/domains"
                      className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition hover:bg-white/[0.035]"
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          domain.status === "active"
                            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                            : domain.status === "error"
                              ? "bg-rose-400"
                              : "bg-amber-400",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-zinc-200">{domain.name}</p>
                        <p className="truncate text-[11px] text-zinc-600">
                          {domain.status === "active"
                            ? `${formatNumber(stats?.sent || 0)} sent in ${days}d`
                            : domain.status === "error"
                              ? "Delivery error"
                              : "Awaiting delivery test"}
                        </p>
                      </div>
                      <ArrowUpRight className="size-3.5 text-zinc-700" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          {data.totals.active_campaigns > 0 ? (
            <div className="border-t border-[#1e1e22] px-5 py-3 text-[11px] text-zinc-500">
              <span className="mr-1 inline-block size-1.5 rounded-full bg-violet-400" />
              {data.totals.active_campaigns} campaign{data.totals.active_campaigns === 1 ? "" : "s"} in progress
            </div>
          ) : null}
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-[#1e1e22] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Recent emails</h2>
            <p className="mt-1 text-xs text-zinc-500">The latest activity across every sending domain.</p>
          </div>
          <Link href="/emails">
            <Button variant="ghost" size="sm">
              View all
              <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
        {data.recent_emails.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Mail className="size-7 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-300">No emails yet</p>
            <p className="mt-1 text-xs text-zinc-600">Your sent email will show up here.</p>
            <Link href="/emails/new" className="mt-4">
              <Button size="sm">
                <Send className="size-3.5" />
                Send your first email
              </Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[#1b1b1f]">
            {data.recent_emails.map((email) => (
              <Link
                key={email.id}
                href={`/emails/${email.id}`}
                className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/[0.022]"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
                  <Mail className="size-3.5 text-zinc-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-200">{email.subject}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                    To {email.to_email} · via {email.domain_name || "unknown domain"}
                  </p>
                </div>
                <div className="hidden items-center gap-2 text-[11px] text-zinc-600 sm:flex">
                  {email.opens > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Eye className="size-3" /> {email.opens}
                    </span>
                  ) : null}
                  {email.clicks > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick className="size-3" /> {email.clicks}
                    </span>
                  ) : null}
                </div>
                <StatusBadge status={email.status} />
                <span className="hidden w-20 text-right text-[11px] text-zinc-600 md:block">
                  {formatRelative(email.created_at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}


"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BookOpenCheck,
  Eye,
  Megaphone,
  Percent,
  RefreshCw,
  Send,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { ApiError, fetcher } from "@/lib/api";
import type { Analytics } from "@/lib/types";
import { cn, formatNumber, formatRelative } from "@/lib/utils";
import { EmptyState, PageHeader, PageLoading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { EmailChart } from "@/components/email-chart";
import { StatusBadge } from "@/components/status-badge";

const periods = [7, 30, 90];

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const { data, error, isLoading, mutate } = useSWR<Analytics>(
    `/analytics?days=${days}`,
    fetcher,
    {
      keepPreviousData: true,
      refreshInterval: 15000,
    },
  );

  if (isLoading && !data) return <PageLoading />;

  if (error || !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/[0.06]">
          <RefreshCw className="size-4 text-rose-300" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-100">Could not load reports</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">
          {error instanceof ApiError
            ? error.message
            : "Check the API connection and try again."}
        </p>
        <Button variant="secondary" className="mt-6" onClick={() => mutate()}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  const campaigns = data.campaigns || [];
  const domains = data.domains || [];
  const attempts = data.totals.sent + data.totals.failed;
  const failedRate = attempts > 0 ? (data.totals.failed / attempts) * 100 : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Delivery and reading performance for your workspace, broken down by campaign and sending domain."
        actions={
          <div
            className="flex items-center rounded-lg border border-[#2a2a2f] bg-[#0a0a0d] p-0.5"
            role="group"
            aria-label="Report period"
          >
            {periods.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => setDays(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[11px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-violet-500/50",
                  days === value
                    ? "bg-white/[0.08] text-zinc-200"
                    : "text-zinc-600 hover:text-zinc-300",
                )}
              >
                {value}d
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Emails sent"
          value={formatNumber(data.totals.sent)}
          hint={`Delivered in the last ${days} days`}
          icon={Send}
          accent="violet"
        />
        <StatCard
          label="Read rate"
          value={formatRate(data.totals.open_rate)}
          hint={`${formatNumber(data.totals.opened)} unique opens`}
          icon={BookOpenCheck}
          accent="mint"
        />
        <StatCard
          label="Unique opens"
          value={formatNumber(data.totals.opened)}
          hint="Recipients who opened at least once"
          icon={Eye}
          accent="sky"
        />
        <StatCard
          label="Failed deliveries"
          value={formatNumber(data.totals.failed)}
          hint={
            data.totals.failed > 0
              ? `${formatRate(failedRate)} of delivery attempts`
              : "No delivery failures"
          }
          icon={AlertTriangle}
          accent="rose"
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Sent vs read"
          description={`Daily delivery and unique open activity over the last ${days} days.`}
        />
        <div className="p-4 sm:p-5">
          <EmailChart data={data.series} />
        </div>
      </Card>

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1e1e22] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Campaign performance</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Sent and read totals for campaigns with activity in this period.
              </p>
            </div>
            <Link href="/campaigns">
              <Button variant="ghost" size="sm">
                All campaigns
                <ArrowUpRight className="size-3" />
              </Button>
            </Link>
          </div>

          {campaigns.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="No campaign activity"
              description="Campaign delivery and read data will appear here after you send your first campaign."
              action={
                <Link href="/campaigns/new">
                  <Button>
                    <Megaphone className="size-4" />
                    New campaign
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[700px] text-left">
                  <thead>
                    <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                      <th className="px-5 py-3 font-medium">Campaign</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Sent</th>
                      <th className="px-4 py-3 text-right font-medium">Opened</th>
                      <th className="px-4 py-3 text-right font-medium">Read rate</th>
                      <th className="px-5 py-3 text-right font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1e]">
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id} className="group transition hover:bg-white/[0.022]">
                        <td className="px-5 py-4">
                          <Link href={`/campaigns/${campaign.id}`} className="flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
                              <Megaphone className="size-4 text-violet-300" />
                            </div>
                            <div className="min-w-0">
                              <p className="max-w-[260px] truncate text-[13px] font-medium text-zinc-200 group-hover:text-zinc-100">
                                {campaign.name}
                              </p>
                              <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-zinc-600">
                                {campaign.subject || "No subject"} · {formatRelative(campaign.last_activity)}
                              </p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={campaign.status} />
                        </td>
                        <td className="px-4 py-4 text-right text-[12px] tabular-nums text-zinc-300">
                          {formatNumber(campaign.sent)}
                        </td>
                        <td className="px-4 py-4 text-right text-[12px] tabular-nums text-zinc-400">
                          {formatNumber(campaign.opened)}
                        </td>
                        <td className="px-4 py-4 text-right text-[12px] font-medium tabular-nums text-zinc-200">
                          {campaign.sent > 0 ? formatRate(campaign.read_rate) : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-5 py-4 text-right text-[12px] tabular-nums",
                            campaign.failed > 0 ? "text-rose-300" : "text-zinc-600",
                          )}
                        >
                          {campaign.failed > 0 ? formatNumber(campaign.failed) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-[#1a1a1e] md:hidden">
                {campaigns.map((campaign) => (
                  <Link
                    key={campaign.id}
                    href={`/campaigns/${campaign.id}`}
                    className="block p-4 transition hover:bg-white/[0.022]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
                        <Megaphone className="size-4 text-violet-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-zinc-200">{campaign.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {campaign.subject || "No subject"}
                        </p>
                      </div>
                      <StatusBadge status={campaign.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
                      <ReportValue label="Sent" value={formatNumber(campaign.sent)} />
                      <ReportValue label="Opened" value={formatNumber(campaign.opened)} />
                      <ReportValue
                        label="Read rate"
                        value={campaign.sent > 0 ? formatRate(campaign.read_rate) : "—"}
                      />
                      <ReportValue
                        label="Failed"
                        value={campaign.failed > 0 ? formatNumber(campaign.failed) : "—"}
                        danger={campaign.failed > 0}
                      />
                    </div>
                    <p className="mt-3 text-[10px] text-zinc-600">
                      Last activity {formatRelative(campaign.last_activity)}
                    </p>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Domain performance"
            description="Read rates by sending domain."
            action={
              <Link href="/domains">
                <Button variant="ghost" size="sm">
                  Manage
                  <ArrowUpRight className="size-3" />
                </Button>
              </Link>
            }
          />
          {domains.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="No domain activity"
              description="Sent and read totals will appear here once a domain starts delivering mail."
              action={
                <Link href="/domains">
                  <Button variant="secondary" size="sm">
                    Add domain
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-[#1a1a1e]">
              {domains.map((domain) => (
                <div key={domain.id} className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
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
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-200">
                      {domain.name}
                    </p>
                    <span className="text-[10px] capitalize text-zinc-600">{domain.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <ReportValue label="Sent" value={formatNumber(domain.sent)} />
                    <ReportValue label="Opened" value={formatNumber(domain.opened)} />
                    <ReportValue
                      label="Read rate"
                      value={domain.sent > 0 ? formatRate(domain.open_rate) : "—"}
                    />
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${domain.name} read rate`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={domain.open_rate}
                    className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.055]"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-300"
                      style={{ width: `${Math.min(100, domain.open_rate)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-[#232327] bg-white/[0.015] px-4 py-3.5">
        <Percent className="mt-0.5 size-3.5 shrink-0 text-zinc-600" />
        <p className="text-[11px] leading-relaxed text-zinc-600">
          Read rate is the number of emails with at least one open divided by delivered emails.
          Opens can be inflated by privacy features and image proxies, so treat this metric as an
          estimate rather than a precise read count.
        </p>
      </div>
    </div>
  );
}

function ReportValue({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.1em] text-zinc-600">{label}</p>
      <p className={cn("mt-0.5 tabular-nums", danger ? "text-rose-300" : "text-zinc-300")}>
        {value}
      </p>
    </div>
  );
}

function formatRate(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

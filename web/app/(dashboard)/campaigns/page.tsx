"use client";

import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, Megaphone, Plus, Send, Users } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { Campaign } from "@/lib/types";
import { cn, formatDate, formatNumber, percent } from "@/lib/utils";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

const filters = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Sent" },
  { value: "canceled", label: "Canceled" },
];

const PAGE_SIZE = 25;

export default function CampaignsPage() {
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status !== "all") query.set("status", status);
  const { data, isLoading } = useSWR<{ campaigns: Campaign[]; total: number }>(
    `/campaigns?${query.toString()}`,
    fetcher,
    {
      keepPreviousData: true,
      refreshInterval: (latest) =>
        latest?.campaigns.some((campaign) => campaign.status === "sending") ? 5000 : 0,
    },
  );
  const campaigns = data?.campaigns || [];
  const total = data?.total || 0;

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Send newsletters and product updates to your audiences through your own SMTP servers."
        actions={
          <Link href="/campaigns/new">
            <Button>
              <Plus className="size-4" />
              New campaign
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex items-center gap-1 overflow-x-auto">
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => {
              setStatus(filter.value);
              setOffset(0);
            }}
            className={cn(
              "whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-medium transition",
              status === filter.value
                ? "border-[#33333a] bg-white/[0.06] text-zinc-100"
                : "border-transparent text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {isLoading && !data ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 p-3">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-5" />}
            title={status === "all" ? "No campaigns yet" : `No ${status} campaigns`}
            description="Create a campaign, choose an audience and send at scale through your SMTP infrastructure."
            action={
              <Link href="/campaigns/new">
                <Button>
                  <Plus className="size-4" />
                  New campaign
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Audience</th>
                  <th className="px-4 py-3 text-right font-medium">Recipients</th>
                  <th className="px-4 py-3 text-right font-medium">Open rate</th>
                  <th className="px-4 py-3 text-right font-medium">Click rate</th>
                  <th className="px-5 py-3 text-right font-medium">
                    {status === "scheduled" ? "Scheduled" : "Created"}
                  </th>
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
                          <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-zinc-600">{campaign.subject || "No subject"}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge status={campaign.status} />
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400">
                        <Users className="size-3 text-zinc-600" />
                        {campaign.audience_name || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-[12px] tabular-nums text-zinc-400">
                      {formatNumber(campaign.total_recipients)}
                    </td>
                    <td className="px-4 py-4 text-right text-[12px] tabular-nums text-zinc-300">
                      {campaign.sent_count > 0
                        ? percent((campaign.opened_count / campaign.sent_count) * 100)
                        : "—"}
                    </td>
                    <td className="px-4 py-4 text-right text-[12px] tabular-nums text-zinc-300">
                      {campaign.sent_count > 0
                        ? percent((campaign.clicked_count / campaign.sent_count) * 100)
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-[11px] text-zinc-500">
                      {campaign.scheduled_at && campaign.status === "scheduled" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="size-3 text-zinc-600" />
                          {formatDate(campaign.scheduled_at, true)}
                        </span>
                      ) : (
                        formatDate(campaign.created_at)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="mt-5 flex items-center gap-2 text-[11px] text-zinc-600">
        <Send className="size-3.5" />
        Campaigns are queued in Redis and sent one-by-one over SMTP. Unsubscribed contacts are skipped automatically.
      </div>
    </div>
  );
}

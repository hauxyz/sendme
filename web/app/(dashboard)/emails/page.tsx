"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Mail, MousePointerClick, Search, Send } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { EmailSummary } from "@/lib/types";
import { cn, formatDate, formatNumber, formatRelative } from "@/lib/utils";
import { PageHeader, EmptyState, Skeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";

const filters = [
  { value: "all", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 25;

export default function EmailsPage() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    status,
  });
  if (debouncedSearch) params.set("search", debouncedSearch);
  const { data, error, isLoading } = useSWR<{ emails: EmailSummary[]; total: number }>(
    `/emails?${params.toString()}`,
    fetcher,
    {
      keepPreviousData: true,
      refreshInterval: (latest) =>
        latest?.emails.some((email) => email.status === "queued" || email.status === "sending") ? 4000 : 0,
    },
  );

  const emails = data?.emails || [];
  const total = data?.total || 0;

  return (
    <div>
      <PageHeader
        title="Emails"
        description="Every transactional email, campaign delivery and retry across your domains."
        actions={
          <Link href="/emails/new">
            <Button>
              <Send className="size-4" />
              Send email
            </Button>
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#1e1e22] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1 overflow-x-auto">
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setStatus(filter.value);
                  setOffset(0);
                }}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                  status === filter.value
                    ? "bg-white/[0.07] text-zinc-100"
                    : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipient or subject…"
              className="h-9 pl-9 text-[13px]"
            />
          </div>
        </div>

        {isLoading && !data ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-2 py-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={<Mail className="size-5" />}
            title="Couldn't load emails"
            description="There was a problem reaching the API. Refresh the page to try again."
          />
        ) : emails.length === 0 ? (
          <EmptyState
            icon={<Mail className="size-5" />}
            title={search ? "No matching emails" : "No emails yet"}
            description={
              search
                ? "Try a different search term or clear the filters."
                : "Send your first email through your own SMTP server. It will appear here once queued."
            }
            action={
              <Link href="/emails/new">
                <Button>
                  <Send className="size-4" />
                  Send email
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                  <th className="px-5 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-center font-medium">Opens</th>
                  <th className="px-4 py-3 text-center font-medium">Clicks</th>
                  <th className="px-5 py-3 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1e]">
                {emails.map((email) => (
                  <tr key={email.id} className="group transition hover:bg-white/[0.022]">
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <Link href={`/emails/${email.id}`} className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
                          <Mail className="size-3.5 text-zinc-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-[190px] truncate text-[13px] font-medium text-zinc-200">
                            {email.to_name || email.to_email}
                          </p>
                          {email.to_name ? (
                            <p className="max-w-[190px] truncate text-[11px] text-zinc-600">{email.to_email}</p>
                          ) : null}
                        </div>
                      </Link>
                    </td>
                    <td className="max-w-[300px] px-4 py-3.5">
                      <Link href={`/emails/${email.id}`} className="block">
                        <p className="truncate text-[13px] text-zinc-300 group-hover:text-zinc-100">
                          {email.subject}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                          {email.source === "campaign" && email.campaign_name
                            ? email.campaign_name
                            : email.source === "api"
                              ? "API"
                              : email.source === "dashboard"
                                ? "Dashboard"
                                : "Test"}
                        </p>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className="rounded-md border border-[#2a2a2f] bg-white/[0.02] px-2 py-1 text-[11px] text-zinc-400">
                        {email.domain_name || "—"}
                      </span>
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
                      <span title={formatDate(email.created_at, true)}>{formatRelative(email.created_at)}</span>
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
              Showing <span className="text-zinc-300">{offset + 1}</span>–
              <span className="text-zinc-300">{Math.min(offset + PAGE_SIZE, total)}</span> of{" "}
              <span className="text-zinc-300">{formatNumber(total)}</span>
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
    </div>
  );
}

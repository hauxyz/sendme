"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Megaphone } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { Campaign } from "@/lib/types";
import { PageLoading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { CampaignForm } from "@/components/campaign-form";

export default function EditCampaignPage() {
  const params = useParams<{ id: string }>();
  const { data, error, isLoading } = useSWR<{ campaign: Campaign }>(`/campaigns/${params.id}`, fetcher);

  if (isLoading) return <PageLoading />;

  if (error || !data) {
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

  if (data.campaign.status !== "draft") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <Megaphone className="size-8 text-zinc-700" />
        <h1 className="mt-4 text-lg font-semibold">This campaign is locked</h1>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">
          Only draft campaigns can be edited. This campaign has already been scheduled or sent.
        </p>
        <Link href={`/campaigns/${data.campaign.id}`} className="mt-6">
          <Button variant="secondary">View campaign</Button>
        </Link>
      </div>
    );
  }

  return <CampaignForm campaign={data.campaign} />;
}

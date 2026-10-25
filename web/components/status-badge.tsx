import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "mint" | "amber" | "rose" | "violet" | "zinc" | "sky";

const tones: Record<Tone, string> = {
  mint: "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300",
  amber: "border-amber-500/20 bg-amber-500/[0.08] text-amber-300",
  rose: "border-rose-500/20 bg-rose-500/[0.08] text-rose-300",
  violet: "border-violet-500/25 bg-violet-500/[0.09] text-violet-300",
  zinc: "border-zinc-700/70 bg-zinc-800/40 text-zinc-400",
  sky: "border-sky-500/20 bg-sky-500/[0.08] text-sky-300",
};

const dots: Record<Tone, string> = {
  mint: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  violet: "bg-violet-400",
  zinc: "bg-zinc-500",
  sky: "bg-sky-400",
};

export function Badge({
  children,
  tone = "zinc",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize leading-5",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", dots[tone])} /> : null}
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "sent":
    case "active":
    case "delivered":
    case "completed":
      return "mint";
    case "queued":
    case "scheduled":
    case "pending":
      return "amber";
    case "sending":
    case "clicked":
      return "violet";
    case "opened":
      return "sky";
    case "failed":
    case "error":
      return "rose";
    default:
      return "zinc";
  }
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = status.replaceAll("_", " ");
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {label}
    </Badge>
  );
}

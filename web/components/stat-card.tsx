import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const accents = {
  violet: "bg-violet-500/10 text-violet-300 ring-violet-500/15",
  mint: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/15",
  sky: "bg-sky-500/10 text-sky-300 ring-sky-500/15",
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/15",
  rose: "bg-rose-500/10 text-rose-300 ring-rose-500/15",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "violet",
  className,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: LucideIcon;
  accent?: keyof typeof accents;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[#232327] bg-[#0f0f12] p-5 transition hover:border-[#2e2e34]",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-[12px] font-medium text-zinc-500">{label}</p>
        <div className={cn("flex size-8 items-center justify-center rounded-lg ring-1", accents[accent])}>
          <Icon className="size-4" strokeWidth={1.9} />
        </div>
      </div>
      <p className="mt-4 text-[28px] font-semibold leading-none tracking-[-0.04em] text-zinc-50 tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-3 text-[11px] text-zinc-500">{hint}</p> : null}
      <div className="pointer-events-none absolute -bottom-10 -right-10 size-24 rounded-full bg-violet-500/[0.035] blur-2xl transition group-hover:bg-violet-500/[0.07]" />
    </div>
  );
}

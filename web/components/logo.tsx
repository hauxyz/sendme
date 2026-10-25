import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  compact = false,
  markOnly = false,
}: {
  className?: string;
  compact?: boolean;
  markOnly?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600 shadow-[0_4px_16px_-4px_rgba(139,92,246,0.7)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.45),transparent_50%)]" />
        <Send className="relative size-[15px] -rotate-12 text-white" strokeWidth={2.2} />
      </div>
      {!markOnly ? (
        <span className={cn("text-[17px] font-semibold tracking-[-0.04em] text-zinc-50", compact && "text-base")}>
          sendme
        </span>
      ) : null}
    </div>
  );
}

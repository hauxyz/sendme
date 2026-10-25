"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn, copyToClipboard } from "@/lib/utils";

export function CodeBlock({
  code,
  title,
  className,
}: {
  code: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyToClipboard(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard permission errors.
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border border-[#26262b] bg-[#0b0b0e]", className)}>
      <div className="flex items-center justify-between border-b border-[#222226] bg-[#0e0e11] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">{title || "example"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
        >
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-zinc-300">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

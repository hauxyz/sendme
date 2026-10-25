"use client";

import { Mail } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

function wrapDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 32px 24px; background: #ffffff; color: #18181b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.65; }
  h1, h2, h3 { color: #09090b; line-height: 1.25; margin: 1.2em 0 0.5em; font-weight: 700; }
  h1 { font-size: 28px; } h2 { font-size: 22px; } h3 { font-size: 18px; }
  p { margin: 0 0 1em; }
  a { color: #6d28d9; }
  img { max-width: 100%; height: auto; }
  ul, ol { padding-left: 22px; margin: 0 0 1em; }
  li { margin: .25em 0; }
  blockquote { border-left: 3px solid #e4e4e7; color: #52525b; margin: 1em 0; padding-left: 1em; }
  hr { border: 0; border-top: 1px solid #e4e4e7; margin: 1.5em 0; }
</style>
</head>
<body>${html}</body>
</html>`;
}

export function EmailPreview({
  html,
  subject,
  fromName,
  fromEmail,
  to,
  className,
  height = 520,
}: {
  html: string;
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  to?: string;
  className?: string;
  height?: number;
}) {
  const doc = useMemo(() => wrapDocument(html || "<p style='color:#a1a1aa'>Nothing to preview yet.</p>"), [html]);
  const subtitle = [fromName || fromEmail, to ? `to ${to}` : null].filter(Boolean).join(" · ");

  return (
    <div className={cn("overflow-hidden rounded-xl border border-[#232327] bg-[#0f0f12]", className)}>
      <div className="flex items-center gap-3 border-b border-[#232327] px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-2 rounded-full bg-[#3a3a40]" />
          <span className="size-2 rounded-full bg-[#3a3a40]" />
          <span className="size-2 rounded-full bg-[#3a3a40]" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/[0.05]">
            <Mail className="size-3 text-zinc-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-zinc-300">
              {subject || "Your subject line preview"}
            </p>
            {subtitle ? <p className="truncate text-[10px] text-zinc-600">{subtitle}</p> : null}
          </div>
        </div>
        <span className="rounded border border-[#2c2c31] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-600">
          preview
        </span>
      </div>
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={doc}
        style={{ height }}
        className="block w-full bg-white"
      />
    </div>
  );
}

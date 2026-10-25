"use client";

import {
  Bold,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type ToolButton = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  command: string;
  value?: string;
};

const tools: (ToolButton | "divider")[] = [
  { label: "Bold", icon: Bold, command: "bold" },
  { label: "Italic", icon: Italic, command: "italic" },
  { label: "Underline", icon: Underline, command: "underline" },
  { label: "Strikethrough", icon: Strikethrough, command: "strikeThrough" },
  "divider",
  { label: "Heading", icon: Heading2, command: "formatBlock" },
  { label: "Bullet list", icon: List, command: "insertUnorderedList" },
  { label: "Numbered list", icon: ListOrdered, command: "insertOrderedList" },
  { label: "Quote", icon: Quote, command: "formatBlock" },
  "divider",
  { label: "Link", icon: Link2, command: "link" },
  { label: "Clear formatting", icon: Code2, command: "removeFormat" },
];

export function RichEditor({
  value,
  onChange,
  placeholder = "Write your email…",
  minHeight = 320,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"visual" | "html">("visual");

  useEffect(() => {
    if (mode !== "visual") return;
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerHTML !== value) {
      editor.innerHTML = value;
    }
  }, [value, mode]);

  const emit = () => {
    const editor = editorRef.current;
    if (editor) onChange(editor.innerHTML);
  };

  const exec = (tool: ToolButton) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    if (tool.command === "link") {
      const url = window.prompt("Link URL", "https://");
      if (!url) return;
      if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) {
        window.alert("Enter a URL starting with https://, mailto: or tel:");
        return;
      }
      document.execCommand("createLink", false, url);
    } else if (tool.command === "formatBlock" && tool.label === "Quote") {
      const current = document.queryCommandValue("formatBlock");
      document.execCommand("formatBlock", false, current === "blockquote" ? "p" : "blockquote");
    } else if (tool.command === "formatBlock") {
      const current = document.queryCommandValue("formatBlock");
      document.execCommand("formatBlock", false, current === "h2" ? "p" : "h2");
    } else {
      document.execCommand(tool.command, false);
    }
    emit();
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[#2a2a2f] bg-[#0b0b0e] transition focus-within:border-violet-500/50 focus-within:ring-4 focus-within:ring-violet-500/10",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#232327] bg-[#0e0e11] px-2 py-1.5">
        {tools.map((tool, index) => {
          if (tool === "divider") {
            return <span key={`divider-${index}`} className="mx-1 h-4 w-px bg-[#2a2a2f]" />;
          }
          const Icon = tool.icon;
          return (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => exec(tool)}
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <Icon className="size-3.5" />
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-[#2a2a2f]" />
        <button
          type="button"
          title="Undo"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editorRef.current?.focus();
            document.execCommand("undo");
            emit();
          }}
          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <Undo2 className="size-3.5" />
        </button>
        <button
          type="button"
          title="Redo"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editorRef.current?.focus();
            document.execCommand("redo");
            emit();
          }}
          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <Redo2 className="size-3.5" />
        </button>

        <div className="ml-auto flex items-center rounded-md border border-[#2a2a2f] bg-[#0a0a0d] p-0.5">
          {(["visual", "html"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={cn(
                "rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition",
                mode === item ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-300",
              )}
            >
              {item === "visual" ? "Design" : "HTML"}
            </button>
          ))}
        </div>
      </div>

      {mode === "visual" ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          style={{ minHeight }}
          className="rich-editor prose-email max-w-none overflow-y-auto px-5 py-5 outline-none"
        />
      ) : (
        <textarea
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ minHeight }}
          className="w-full resize-y bg-transparent px-5 py-5 font-mono text-[12.5px] leading-relaxed text-zinc-300 outline-none"
          placeholder="<p>Your HTML content…</p>"
        />
      )}

      <div className="flex items-center justify-between border-t border-[#232327] bg-[#0e0e11] px-3 py-1.5 text-[10px] text-zinc-600">
        <span>{mode === "visual" ? "Tip: select text to add a link" : "Paste any valid HTML"}</span>
        <span>{value.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}

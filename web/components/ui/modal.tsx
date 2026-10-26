"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Button } from "./button";

const sizes = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof sizes;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap(open, dialogRef, { onEscape: onClose });

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        className="absolute inset-0 bg-black/70 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "animate-scale-in relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#2a2a2f] bg-[#111114] shadow-[0_30px_120px_rgba(0,0,0,0.65)] outline-none sm:rounded-2xl",
          sizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#1f1f24] px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-zinc-50">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-zinc-500">
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" className="-mr-1 -mt-1 shrink-0" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[#1f1f24] bg-[#0e0e11] px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

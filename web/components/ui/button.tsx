"use client";

import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

export function buttonVariants({ variant = "primary", size = "md" }: { variant?: Variant; size?: Size } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a] disabled:pointer-events-none disabled:opacity-50",
    {
      "bg-violet-500 text-white shadow-[0_1px_0_0_rgba(255,255,255,0.16)_inset,0_8px_20px_-8px_rgba(139,92,246,0.65)] hover:bg-violet-400":
        variant === "primary",
      "border border-[#2a2a2f] bg-white/[0.035] text-zinc-200 hover:border-[#3a3a41] hover:bg-white/[0.06]":
        variant === "secondary",
      "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100": variant === "ghost",
      "border border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200":
        variant === "danger",
      "border border-[#2a2a2f] bg-transparent text-zinc-300 hover:border-[#3a3a41] hover:bg-white/[0.04]":
        variant === "outline",
      "h-8 px-3 text-[13px]": size === "sm",
      "h-10 px-4 text-sm": size === "md",
      "h-11 px-5 text-sm": size === "lg",
      "h-9 w-9": size === "icon",
    },
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
});

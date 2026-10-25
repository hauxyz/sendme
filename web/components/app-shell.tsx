"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Settings,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn, initials } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const primaryNav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/domains", label: "Domains", icon: Globe },
];

const developerNav = [
  { href: "/api-keys", label: "API keys", icon: KeyRound },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/docs", label: "API reference", icon: BookOpen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, error, isLoading, mutate } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const handler = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      await mutate();
      router.replace("/login");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#08080a]">
        <div className="flex flex-col items-center gap-4">
          <Logo />
          <div className="h-0.5 w-24 overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-1/2 animate-[shimmer_1.2s_infinite] rounded-full bg-violet-500" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <Logo className="justify-center" />
          <h1 className="mt-8 text-lg font-semibold">We couldn&apos;t load your workspace</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Make sure the SendMe API is running, then try again.
          </p>
          <Button className="mt-6" onClick={() => mutate()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/dashboard" aria-label="SendMe dashboard">
          <Logo />
        </Link>
        <button
          type="button"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="px-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-[#202024] bg-white/[0.025] px-3 py-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-zinc-700 to-zinc-800 text-[10px] font-semibold text-zinc-200">
            {initials(session.workspace.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-zinc-200">{session.workspace.name}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">Self-hosted</p>
          </div>
        </div>
      </div>

      <nav className="mt-6 flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        <div className="space-y-1">
          {primaryNav.map((item) => (
            <NavItem key={item.href} {...item} pathname={pathname} />
          ))}
        </div>
        <div>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Developers
          </p>
          <div className="space-y-1">
            {developerNav.map((item) => (
              <NavItem key={item.href} {...item} pathname={pathname} />
            ))}
          </div>
        </div>
      </nav>

      <div className="p-3" ref={accountRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-[#26262b] hover:bg-white/[0.03]",
              accountOpen && "border-[#26262b] bg-white/[0.03]",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/20">
              {initials(session.user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-zinc-200">{session.user.name}</p>
              <p className="truncate text-[11px] text-zinc-600">{session.user.email}</p>
            </div>
            <ChevronDown className={cn("size-3.5 text-zinc-600 transition", accountOpen && "rotate-180")} />
          </button>

          {accountOpen ? (
            <div className="animate-fade-in absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-[#2a2a2f] bg-[#141417] p-1 shadow-2xl">
              <Link
                href="/settings"
                onClick={() => setAccountOpen(false)}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-zinc-300 hover:bg-white/[0.05]"
              >
                <Settings className="size-3.5 text-zinc-500" />
                Settings
              </Link>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
              >
                <LogOut className="size-3.5 text-zinc-500" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#08080a]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-[#1c1c20] bg-[#0b0b0e] lg:block">
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside
            className="animate-fade-in absolute inset-y-0 left-0 w-[280px] border-r border-[#1c1c20] bg-[#0b0b0e]"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setMobileOpen(false);
            }}
          >
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[248px]">
        <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#1c1c20] bg-[#08080a]/90 px-4 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <Logo compact />
          <div className="w-9" />
        </div>
        <main className="relative min-h-screen">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(139,92,246,0.045),transparent_80%)]" />
          <div className="relative mx-auto w-full max-w-[1440px] px-5 py-8 lg:px-10 lg:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  pathname: string;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition",
        active ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-200",
      )}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-violet-400" />
      ) : null}
      <Icon
        className={cn("size-[15px] transition", active ? "text-violet-300" : "text-zinc-600 group-hover:text-zinc-400")}
        strokeWidth={active ? 2.1 : 1.8}
      />
      {label}
    </Link>
  );
}

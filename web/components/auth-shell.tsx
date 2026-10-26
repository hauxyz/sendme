import Link from "next/link";
import { ArrowUpRight, Check, Globe, Server, Zap } from "lucide-react";
import { Logo } from "@/components/logo";

const features = [
  {
    icon: Server,
    title: "Direct delivery or your relay",
    description: "Send straight from Go, or connect any SMTP server. No sending APIs.",
  },
  {
    icon: Globe,
    title: "Unlimited domains",
    description: "Each domain keeps its own delivery mode and sender identity.",
  },
  {
    icon: Zap,
    title: "Transactional & campaigns",
    description: "A single API for product email and newsletters.",
  },
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-[#08080a] lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-[#1d1d21] bg-[#0b0b0e] lg:flex lg:flex-col">
        <div className="absolute inset-0 grid-glow opacity-70" />
        <div className="absolute -left-32 top-1/4 size-[480px] rounded-full bg-violet-600/[0.13] blur-[130px]" />
        <div className="absolute -bottom-40 right-0 size-[420px] rounded-full bg-indigo-600/[0.1] blur-[120px]" />

        <div className="relative z-10 flex h-20 items-center px-10">
          <Link href="/" aria-label="SendMe">
            <Logo />
          </Link>
          <span className="ml-4 rounded-full border border-[#2b2b31] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            self-hosted
          </span>
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
          <div className="max-w-xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/[0.07] px-3 py-1.5 text-xs text-violet-300">
              <span className="size-1.5 rounded-full bg-violet-400" />
              SMTP delivery infrastructure
            </div>
            <h1 className="text-balance text-[44px] font-semibold leading-[1.08] tracking-[-0.045em] text-zinc-50 xl:text-[52px]">
              Email infrastructure,
              <br />
              <span className="bg-gradient-to-r from-violet-300 via-violet-400 to-indigo-400 bg-clip-text text-transparent">
                without the middleman.
              </span>
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-zinc-400">
              Run your own email platform on Postgres, Redis and SMTP. Send directly from Go or
              connect a relay, add multiple domains, and launch campaigns from one clean dashboard.
            </p>

            <div className="mt-10 space-y-4">
              {features.map((feature) => (
                <div key={feature.title} className="flex items-start gap-3.5">
                  <div className="mt-0.5 flex size-8 items-center justify-center rounded-lg border border-[#2a2a31] bg-white/[0.03]">
                    <feature.icon className="size-4 text-violet-300" strokeWidth={1.8} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{feature.title}</p>
                    <p className="mt-0.5 text-[13px] text-zinc-500">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-[#1d1d21] px-10 py-5 text-xs text-zinc-600">
          <span>Built with Go, Next.js, Postgres & Redis.</span>
          <Link
            href="https://github.com/hauxyz/sendme"
            target="_blank"
            className="inline-flex items-center gap-1 transition hover:text-zinc-300"
          >
            GitHub <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </div>

      <div className="relative flex min-h-screen flex-col">
        <div className="flex h-16 items-center justify-between border-b border-[#1c1c20] px-5 lg:hidden">
          <Logo />
          <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">self-hosted</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <div className="flex items-center justify-center gap-5 border-t border-[#1c1c20] px-6 py-4 text-[11px] text-zinc-600 lg:justify-end">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3 text-emerald-500" /> Multi-domain
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3 text-emerald-500" /> Direct + SMTP
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3 text-emerald-500" /> Open source
          </span>
        </div>
      </div>
    </div>
  );
}

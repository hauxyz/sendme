"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { api, ApiError, fetcher } from "@/lib/api";
import type { Session } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const { data: session } = useSWR<Session>("/auth/me", fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) router.replace("/dashboard");
  }, [session, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await api<Session>("/auth/register", {
        method: "POST",
        body: {
          name,
          email,
          password,
          workspace_name: workspaceName || undefined,
        },
      });
      await mutate("/auth/me", session, { revalidate: false });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to create your account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-zinc-50">Create your workspace</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Set up your self-hosted email infrastructure in a couple of minutes.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        {error ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-3.5 py-3 text-[13px] text-rose-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="name">
            <Input
              id="name"
              autoComplete="name"
              placeholder="Alex Nguyen"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Workspace" hint="Optional" htmlFor="workspace">
            <Input
              id="workspace"
              placeholder="Acme"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Email address" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password" hint="At least 8 characters." htmlFor="password">
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Create a strong password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              className="pr-11"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-600 transition hover:text-zinc-300"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? "Creating workspace…" : "Create workspace"}
        </Button>
      </form>

      <p className="mt-7 text-center text-[13px] text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-violet-400 transition hover:text-violet-300">
          Sign in
        </Link>
      </p>
    </div>
  );
}

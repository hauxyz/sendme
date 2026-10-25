"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher, PUBLIC_API_URL } from "@/lib/api";
import type { APIKey } from "@/lib/types";
import { copyToClipboard, formatDate, formatRelative } from "@/lib/utils";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { CodeBlock } from "@/components/code-block";

export default function APIKeysPage() {
  const { data, isLoading, mutate } = useSWR<{ api_keys: APIKey[] }>("/api-keys", fetcher);
  const keys = data?.api_keys || [];

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<APIKey | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const openCreate = () => {
    setName("");
    setCreatedKey("");
    setError("");
    setCopied(false);
    setCreateOpen(true);
  };

  const createKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      const result = await api<{ api_key: APIKey; key: string }>("/api-keys", {
        method: "POST",
        body: { name: name.trim() },
      });
      setCreatedKey(result.key);
      toast.success("API key created");
      await mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the API key");
    } finally {
      setCreating(false);
    }
  };

  const copyKey = async () => {
    try {
      await copyToClipboard(createdKey);
      setCopied(true);
      toast.success("API key copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the key. Select it and copy manually.");
    }
  };

  const revokeKey = async () => {
    if (!revoking) return;
    setRevokeLoading(true);
    try {
      await api(`/api-keys/${revoking.id}`, { method: "DELETE" });
      toast.success("API key revoked");
      setRevoking(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not revoke the API key");
    } finally {
      setRevokeLoading(false);
    }
  };

  const curl = `curl -X POST ${PUBLIC_API_URL}/api/v1/emails \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "hello@yourdomain.com",
    "to": "customer@example.com",
    "subject": "Welcome aboard",
    "html": "<h1>Hello!</h1>"
  }'`;

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Send transactional email from your application with workspace-scoped API keys."
        actions={
          <>
            <Link href="/docs">
              <Button variant="secondary">
                <BookOpen className="size-4" />
                API docs
              </Button>
            </Link>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Create key
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-[#232327] bg-[linear-gradient(110deg,rgba(139,92,246,0.055),rgba(15,15,18,0)_60%)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.08]">
            <Zap className="size-4 text-violet-300" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-zinc-200">One API, every verified domain.</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
              Keys are scoped to <span className="font-mono text-[11px] text-zinc-400">{PUBLIC_API_URL}/api/v1</span>.
              Revoked keys stop working immediately.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <ShieldCheck className="size-3.5 text-emerald-400" />
          Keys are stored as SHA-256 hashes
        </div>
      </div>

      <Card className="mb-5 overflow-hidden">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 p-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="size-5" />}
            title="No API keys yet"
            description="Create a key to start sending transactional emails from your application."
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                Create API key
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Key prefix</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last used</th>
                  <th className="px-5 py-3 text-right font-medium">Revoke</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1e]">
                {keys.map((key) => (
                  <tr key={key.id} className="group transition hover:bg-white/[0.022]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
                          <KeyRound className="size-3.5 text-zinc-500" />
                        </div>
                        <p className="text-[13px] font-medium text-zinc-200">{key.name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <code className="rounded border border-[#2a2a2f] bg-[#0b0b0e] px-2 py-1 font-mono text-[11px] text-zinc-400">
                        {key.prefix}…
                      </code>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-[11px] text-zinc-500">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-[11px] text-zinc-500">
                      {key.last_used_at ? formatRelative(key.last_used_at) : "Never"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-zinc-600 opacity-70 transition hover:text-rose-300 group-hover:opacity-100"
                        onClick={() => setRevoking(key)}
                        aria-label={`Revoke ${key.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-zinc-100">Quick start</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Send your first transactional email using the public API.
            </p>
          </div>
          <CodeBlock code={curl} title="cURL" />
        </Card>

        <Card className="p-5">
          <div className="flex size-9 items-center justify-center rounded-lg border border-[#2a2a2f] bg-white/[0.03]">
            <ShieldCheck className="size-4 text-zinc-500" />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-zinc-100">Keep keys secure</h2>
          <ul className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-zinc-500">
            <li>Store keys in a secrets manager, never in client-side code.</li>
            <li>Each key inherits the permissions of this workspace.</li>
            <li>Rotate keys regularly and revoke any key that leaks.</li>
            <li>The full key is shown only once, right after creation.</li>
          </ul>
        </Card>
      </div>

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title={createdKey ? "Your new API key" : "Create API key"}
        description={
          createdKey
            ? "Copy this key now. For security, it won't be shown again."
            : "Give this key a name so you can recognize where it's used."
        }
        footer={
          createdKey ? (
            <Button onClick={() => setCreateOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" form="create-api-key-form" loading={creating}>
                <Plus className="size-4" />
                Create key
              </Button>
            </>
          )
        }
      >
        {createdKey ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-[12px] leading-relaxed text-amber-200/70">
                This is the only time this key is displayed. Store it somewhere safe before closing
                this dialog.
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-[#2a2a2f] bg-[#0b0b0e]">
              <div className="flex items-center justify-between border-b border-[#222226] px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">API key</span>
                <button
                  type="button"
                  onClick={copyKey}
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                >
                  {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="break-all p-3 font-mono text-[12px] leading-relaxed text-zinc-300">{createdKey}</p>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              Use it as a Bearer token: <code className="text-zinc-400">Authorization: Bearer {createdKey.slice(0, 12)}…</code>
            </p>
          </div>
        ) : (
          <form id="create-api-key-form" onSubmit={createKey} className="space-y-4">
            {error ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            <Field label="Key name" hint="For example: Production app, Staging, or Zapier." htmlFor="api-key-name">
              <Input
                id="api-key-name"
                placeholder="Production app"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
                autoFocus
              />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title="Revoke API key?"
        description={`${revoking?.name || "This key"} will stop working immediately.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)} disabled={revokeLoading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={revokeKey} loading={revokeLoading}>
              Revoke key
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Applications using this key will receive <code className="text-zinc-300">401 Unauthorized</code>{" "}
          responses. This action cannot be undone. Create a replacement key first if you need zero
          downtime.
        </p>
      </Modal>
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import type { Webhook, WebhookDelivery } from "@/lib/types";
import { cn, copyToClipboard, formatDate, formatRelative } from "@/lib/utils";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/page";
import { Badge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Switch } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export default function WebhooksPage() {
  const { data, isLoading, mutate } = useSWR<{
    webhooks: Webhook[];
    available_events: string[];
  }>("/webhooks", fetcher);
  const webhooks = data?.webhooks || [];
  const availableEvents = data?.available_events || [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);

  const toggle = async (hook: Webhook, enabled: boolean) => {
    setToggling(hook.id);
    try {
      await api(`/webhooks/${hook.id}`, { method: "PATCH", body: { enabled } });
      toast.success(enabled ? "Webhook enabled" : "Webhook paused");
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the webhook");
    } finally {
      setToggling(null);
    }
  };

  const test = async (hook: Webhook) => {
    setTesting(hook.id);
    try {
      await api(`/webhooks/${hook.id}/test`, { method: "POST" });
      toast.success("Test event queued for delivery");
      setDeliveriesFor(hook);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not queue the test event");
    } finally {
      setTesting(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api(`/webhooks/${deleting.id}`, { method: "DELETE" });
      toast.success("Webhook deleted");
      setDeleting(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the webhook");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Receive signed HTTP callbacks when emails are delivered, opened, clicked, or a campaign completes."
        actions={
          <>
            <Link href="/docs#webhooks">
              <Button variant="secondary">
                <ShieldCheck className="size-4" />
                Signing guide
              </Button>
            </Link>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              Add webhook
            </Button>
          </>
        }
      />

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#232327] bg-[#0f0f12] px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
          <WebhookIcon className="size-4 text-violet-300" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-zinc-200">Verify every request</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
            Deliveries include an <code className="text-zinc-400">X-SendMe-Signature</code> header.
            Compute an HMAC-SHA256 over{" "}
            <code className="text-zinc-400">timestamp.payload</code> using the webhook secret and compare
            it before processing. Failed deliveries are retried automatically.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-xl border border-[#232327] bg-[#0f0f12]" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<WebhookIcon className="size-5" />}
            title="No webhooks yet"
            description="Add an endpoint to get notified about delivery and engagement events in real time."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" />
                Add webhook
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((hook) => (
            <WebhookCard
              key={hook.id}
              hook={hook}
              toggling={toggling === hook.id}
              testing={testing === hook.id}
              onToggle={(enabled) => toggle(hook, enabled)}
              onTest={() => test(hook)}
              onDeliveries={() => setDeliveriesFor(hook)}
              onEdit={() => {
                setEditing(hook);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(hook)}
            />
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit webhook" : "Add webhook"}
        description="Choose an HTTPS endpoint and the events you want to receive."
        size="lg"
      >
        <WebhookForm
          key={editing?.id || "new"}
          webhook={editing}
          availableEvents={availableEvents}
          onCancel={() => setFormOpen(false)}
          onSaved={async () => {
            setFormOpen(false);
            setEditing(null);
            await mutate();
          }}
        />
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete webhook?"
        description={`${deleting?.url || "This endpoint"} will stop receiving events.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={deleteLoading}>
              Delete webhook
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          The webhook secret and its delivery history will be removed. This action cannot be undone.
        </p>
      </Modal>

      <DeliveriesModal webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
    </div>
  );
}

function WebhookCard({
  hook,
  toggling,
  testing,
  onToggle,
  onTest,
  onDeliveries,
  onEdit,
  onDelete,
}: {
  hook: Webhook;
  toggling: boolean;
  testing: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onDeliveries: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copySecret = async () => {
    try {
      await copyToClipboard(hook.secret);
      setCopied(true);
      toast.success("Signing secret copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy the secret");
    }
  };

  return (
    <Card className={cn("overflow-hidden", !hook.enabled && "opacity-75")}>
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
              <WebhookIcon className="size-3.5 text-zinc-500" />
            </div>
            <code className="break-all text-[12.5px] font-medium text-zinc-200">{hook.url}</code>
            <Badge tone={hook.enabled ? "mint" : "zinc"} dot>
              {hook.enabled ? "Active" : "Paused"}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {hook.events.map((event) => (
              <span
                key={event}
                className="rounded-md border border-[#2a2a2f] bg-[#0b0b0e] px-2 py-0.5 font-mono text-[10px] text-zinc-400"
              >
                {event}
              </span>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2">
            <ShieldCheck className="size-3.5 shrink-0 text-zinc-600" />
            <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Secret</span>
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-zinc-400">
              {revealed ? hook.secret : "whsec_••••••••••••••••••••"}
            </code>
            <button
              type="button"
              onClick={() => setRevealed((current) => !current)}
              className="rounded p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300"
              aria-label={revealed ? "Hide signing secret" : "Show signing secret"}
            >
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={copySecret}
              className="rounded p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300"
              aria-label="Copy signing secret"
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            </button>
          </div>

          <p className="mt-3 text-[10.5px] text-zinc-600">
            Created {formatRelative(hook.created_at)}
            {hook.updated_at ? ` · Updated ${formatRelative(hook.updated_at)}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
          <Switch
            checked={hook.enabled}
            onChange={onToggle}
            label={toggling ? "Updating…" : hook.enabled ? "Enabled" : "Paused"}
            disabled={toggling}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={onTest} loading={testing}>
              <Send className="size-3.5" />
              Test
            </Button>
            <Button variant="ghost" size="sm" onClick={onDeliveries}>
              Deliveries
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-zinc-600 hover:text-rose-300"
              onClick={onDelete}
              aria-label="Delete webhook"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function WebhookForm({
  webhook,
  availableEvents,
  onCancel,
  onSaved,
}: {
  webhook?: Webhook | null;
  availableEvents: string[];
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState(webhook?.url || "");
  const [events, setEvents] = useState<string[]>(
    webhook?.events || availableEvents.filter((event) => event.startsWith("email.")),
  );
  const [enabled, setEnabled] = useState(webhook?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleEvent = (event: string) => {
    setEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (events.length === 0) {
      setError("Select at least one event to receive.");
      return;
    }
    setSaving(true);
    try {
      const payload = { url: url.trim(), events, enabled };
      if (webhook) {
        await api(`/webhooks/${webhook.id}`, { method: "PATCH", body: payload });
        toast.success("Webhook updated");
      } else {
        await api("/webhooks", { method: "POST", body: { url: payload.url, events } });
        toast.success("Webhook added");
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the webhook.");
    } finally {
      setSaving(false);
    }
  };

  const selectAll = () => {
    if (events.length === availableEvents.length) setEvents([]);
    else setEvents([...availableEvents]);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Field
        label="Endpoint URL"
        hint="Must be a publicly reachable HTTP or HTTPS endpoint. We send POST requests with a JSON body."
        htmlFor="webhook-url"
      >
        <Input
          id="webhook-url"
          type="url"
          placeholder="https://example.com/webhooks/sendme"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          autoFocus
        />
      </Field>

      {webhook ? (
        <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3.5">
          <Switch
            checked={enabled}
            onChange={setEnabled}
            label="Webhook enabled"
            description="Paused webhooks keep their configuration but stop receiving new events."
          />
        </div>
      ) : null}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-zinc-300">Events</h3>
          <button
            type="button"
            onClick={selectAll}
            className="text-[11px] text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline"
          >
            {events.length === availableEvents.length ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="grid gap-1.5 rounded-lg border border-[#26262b] bg-[#0b0b0e] p-2 sm:grid-cols-2">
          {availableEvents.map((event) => {
            const checked = events.includes(event);
            return (
              <label
                key={event}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 transition",
                  checked
                    ? "border-violet-500/25 bg-violet-500/[0.06]"
                    : "border-transparent hover:bg-white/[0.03]",
                )}
              >
                <Checkbox checked={checked} onChange={() => toggleEvent(event)} />
                <span className="font-mono text-[11.5px] text-zinc-300">{event}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Test events are always delivered as <code className="text-zinc-400">webhook.test</code>{" "}
          regardless of this selection.
        </p>
      </section>

      <div className="flex items-center justify-between border-t border-[#1f1f24] pt-5">
        <p className="max-w-sm text-[11px] leading-relaxed text-zinc-600">
          Requests are signed with this webhook&apos;s secret. Verify the signature before trusting
          the payload.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {webhook ? "Save changes" : "Add webhook"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function DeliveriesModal({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const { data, isLoading, mutate, isValidating } = useSWR<{ deliveries: WebhookDelivery[] }>(
    webhook ? `/webhooks/${webhook.id}/deliveries` : null,
    fetcher,
    { refreshInterval: 4000 },
  );
  const deliveries = data?.deliveries || [];

  return (
    <Modal
      open={Boolean(webhook)}
      onClose={onClose}
      title="Webhook deliveries"
      description={webhook?.url}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" onClick={() => mutate()} loading={isValidating}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : deliveries.length === 0 ? (
        <EmptyState
          icon={<WebhookIcon className="size-5" />}
          title="No deliveries yet"
          description="Trigger a test event or wait for the next workspace event to see delivery attempts."
        />
      ) : (
        <div className="space-y-2">
          {deliveries.map((delivery) => {
            const pending = !delivery.delivered_at && !delivery.error;
            const failed = Boolean(delivery.error);
            return (
              <div key={delivery.id} className="rounded-lg border border-[#26262b] bg-[#0b0b0e]">
                <div className="flex flex-col gap-2 border-b border-[#222226] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-[11px] text-zinc-300">{delivery.event}</code>
                    {pending ? (
                      <Badge tone="amber" dot>
                        Pending
                      </Badge>
                    ) : failed ? (
                      <Badge tone="rose" dot>
                        Failed
                      </Badge>
                    ) : (
                      <Badge tone="mint" dot>
                        Delivered
                      </Badge>
                    )}
                    {delivery.status_code ? (
                      <span className={cn("text-[10px]", delivery.status_code < 300 ? "text-emerald-400" : "text-rose-400")}>
                        HTTP {delivery.status_code}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                    <span>{delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}</span>
                    <span>{formatRelative(delivery.created_at)}</span>
                  </div>
                </div>
                <div className="space-y-2 px-4 py-3">
                  {delivery.error ? (
                    <p className="break-words font-mono text-[10.5px] leading-relaxed text-rose-300/80">
                      {delivery.error}
                    </p>
                  ) : null}
                  <details className="group">
                    <summary className="cursor-pointer text-[10px] text-zinc-600 transition hover:text-zinc-400">
                      Payload
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[#222226] bg-black/30 p-2.5 font-mono text-[10px] leading-relaxed text-zinc-500">
                      {JSON.stringify(delivery.payload, null, 2)}
                    </pre>
                  </details>
                  {delivery.response_body ? (
                    <details>
                      <summary className="cursor-pointer text-[10px] text-zinc-600 transition hover:text-zinc-400">
                        Response body
                      </summary>
                      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[#222226] bg-black/30 p-2.5 font-mono text-[10px] leading-relaxed text-zinc-500">
                        {delivery.response_body}
                      </pre>
                    </details>
                  ) : null}
                  {delivery.delivered_at ? (
                    <p className="text-[10px] text-zinc-600">
                      Delivered {formatDate(delivery.delivered_at, true)}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

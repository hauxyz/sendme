"use client";

import { AlertTriangle, CheckCircle2, Clock, Globe, KeyRound, Mail, Pencil, Plus, RefreshCw, Server, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { DNSResult, Domain } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/status-badge";

export default function DomainsPage() {
  const { session } = useSession();
  const { data, isLoading, mutate } = useSWR<{ domains: Domain[] }>("/domains", fetcher);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const [testing, setTesting] = useState<Domain | null>(null);
  const [dnsDomain, setDnsDomain] = useState<Domain | null>(null);
  const [deleting, setDeleting] = useState<Domain | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const domains = data?.domains || [];
  const active = domains.filter((domain) => domain.status === "active").length;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (domain: Domain) => {
    setEditing(domain);
    setFormOpen(true);
  };

  const deleteDomain = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api(`/domains/${deleting.id}`, { method: "DELETE" });
      toast.success("Domain removed");
      setDeleting(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the domain");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Domains"
        description="Connect unlimited sending domains to your own SMTP servers. Credentials are encrypted at rest."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add domain
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-[#232327] bg-[linear-gradient(110deg,rgba(139,92,246,0.055),rgba(15,15,18,0)_60%)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.08]">
            <Server className="size-4 text-violet-300" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-zinc-200">SMTP only. No third-party providers.</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
              Each domain has its own SMTP host, credentials and sender identity. SendMe connects
              directly to your mail server.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {active} verified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-400" />
            {domains.length - active} pending
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-xl border border-[#232327] bg-[#0f0f12]" />
          ))}
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-xl border border-[#232327] bg-[#0f0f12]">
          <EmptyState
            icon={<Globe className="size-5" />}
            title="Add your first sending domain"
            description="Point SendMe at any SMTP server. We'll run a test email to verify the connection."
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                Add domain
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain) => (
            <div key={domain.id} className="flex flex-col rounded-xl border border-[#232327] bg-[#0f0f12] transition hover:border-[#2c2c31]">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg border text-[15px] font-semibold",
                        domain.status === "active"
                          ? "border-emerald-500/15 bg-emerald-500/[0.07] text-emerald-300"
                          : domain.status === "error"
                            ? "border-rose-500/15 bg-rose-500/[0.07] text-rose-300"
                            : "border-violet-500/15 bg-violet-500/[0.07] text-violet-300",
                      )}
                    >
                      {domain.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">{domain.name}</h2>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{domain.from_email}</p>
                    </div>
                  </div>
                  <StatusBadge status={domain.status} />
                </div>

                <div className="mt-5 space-y-2.5">
                  <InfoRow icon={Server} label="SMTP server" value={`${domain.smtp_host}:${domain.smtp_port}`} />
                  <InfoRow
                    icon={ShieldCheck}
                    label="Security"
                    value={`${domain.smtp_security === "starttls" ? "STARTTLS" : domain.smtp_security === "tls" ? "TLS" : "None"} · ${domain.smtp_auth === "none" ? "No auth" : domain.smtp_auth.toUpperCase()}`}
                  />
                  <InfoRow
                    icon={Clock}
                    label="Last tested"
                    value={domain.last_tested_at ? formatRelative(domain.last_tested_at) : "Never tested"}
                  />
                </div>

                {domain.last_error ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/15 bg-rose-500/[0.05] px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
                    <p className="line-clamp-3 break-words text-[10.5px] leading-relaxed text-rose-300/80">
                      {domain.last_error}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="mt-auto flex items-center gap-1 border-t border-[#1e1e22] p-2.5">
                <Button variant="ghost" size="sm" onClick={() => setTesting(domain)}>
                  <RefreshCw className="size-3.5" />
                  Test SMTP
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(domain)}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDnsDomain(domain)}>
                  DNS
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto text-zinc-600 hover:text-rose-300"
                  onClick={() => setDeleting(domain)}
                  aria-label="Delete domain"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit domain" : "Add sending domain"}
        description="Configure the sender identity and SMTP credentials for this domain."
        size="xl"
      >
        <DomainForm
          key={editing?.id || "new"}
          domain={editing}
          onCancel={() => setFormOpen(false)}
          onSaved={async () => {
            setFormOpen(false);
            await mutate();
          }}
        />
      </Modal>

      <TestDomainModal
        key={testing?.id || "none"}
        domain={testing}
        defaultEmail={session?.user.email || ""}
        onClose={() => setTesting(null)}
        onComplete={async () => {
          await mutate();
        }}
      />

      <DNSModal domain={dnsDomain} onClose={() => setDnsDomain(null)} />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete domain?"
        description={`This removes ${deleting?.name || "the domain"} and its SMTP credentials. Existing email history is preserved.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteDomain} loading={deleteLoading}>
              Delete domain
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Campaigns and emails that used this domain will no longer be able to send through it.
          This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 text-[11.5px]">
      <Icon className="size-3.5 shrink-0 text-zinc-600" />
      <span className="w-20 shrink-0 text-zinc-600">{label}</span>
      <span className="truncate text-zinc-400">{value}</span>
    </div>
  );
}

type FormState = {
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  smtp_host: string;
  smtp_port: string;
  smtp_security: string;
  smtp_auth: string;
  smtp_username: string;
  smtp_password: string;
};

function DomainForm({
  domain,
  onSaved,
  onCancel,
}: {
  domain: Domain | null;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: domain?.name || "",
    from_name: domain?.from_name || "",
    from_email: domain?.from_email || "",
    reply_to: domain?.reply_to || "",
    smtp_host: domain?.smtp_host || "",
    smtp_port: String(domain?.smtp_port || 587),
    smtp_security: domain?.smtp_security || "starttls",
    smtp_auth: domain?.smtp_auth || "plain",
    smtp_username: domain?.smtp_username || "",
    smtp_password: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "name") {
        const oldDefault = `noreply@${current.name}`;
        if (!current.from_email || current.from_email === oldDefault) {
          next.from_email = value ? `noreply@${value}` : "";
        }
      }
      if (key === "smtp_security") {
        if (value === "tls" && (current.smtp_port === "587" || !current.smtp_port)) next.smtp_port = "465";
        if (value === "starttls" && (current.smtp_port === "465" || !current.smtp_port)) next.smtp_port = "587";
      }
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim().toLowerCase(),
        from_name: form.from_name.trim(),
        from_email: form.from_email.trim(),
        reply_to: form.reply_to.trim(),
        smtp_host: form.smtp_host.trim(),
        smtp_port: Number(form.smtp_port),
        smtp_security: form.smtp_security,
        smtp_auth: form.smtp_auth,
        smtp_username: form.smtp_username.trim(),
      };
      if (form.smtp_password) payload.smtp_password = form.smtp_password;
      if (domain) {
        await api(`/domains/${domain.id}`, { method: "PATCH", body: payload });
        toast.success("Domain updated");
      } else {
        payload.smtp_password = form.smtp_password;
        await api("/domains", { method: "POST", body: payload });
        toast.success("Domain added. Run an SMTP test to activate it.");
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the domain");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          <Mail className="size-3.5" /> Sender identity
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Domain" hint="The domain you send email from." htmlFor="domain-name">
            <Input
              id="domain-name"
              placeholder="example.com"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="From name" hint="Shown next to the sender address." htmlFor="from-name">
            <Input
              id="from-name"
              placeholder="Acme"
              value={form.from_name}
              onChange={(event) => update("from_name", event.target.value)}
            />
          </Field>
          <Field label="From email" htmlFor="from-email">
            <Input
              id="from-email"
              type="email"
              placeholder="hello@example.com"
              value={form.from_email}
              onChange={(event) => update("from_email", event.target.value)}
              required
            />
          </Field>
          <Field label="Reply-to" hint="Optional." htmlFor="reply-to-domain">
            <Input
              id="reply-to-domain"
              type="email"
              placeholder="support@example.com"
              value={form.reply_to}
              onChange={(event) => update("reply_to", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <div className="h-px bg-[#1f1f24]" />

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          <Server className="size-3.5" /> SMTP connection
        </h3>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="SMTP host" htmlFor="smtp-host">
            <Input
              id="smtp-host"
              placeholder="smtp.example.com"
              value={form.smtp_host}
              onChange={(event) => update("smtp_host", event.target.value)}
              required
            />
          </Field>
          <Field label="Port" htmlFor="smtp-port">
            <Input
              id="smtp-port"
              type="number"
              min={1}
              max={65535}
              value={form.smtp_port}
              onChange={(event) => update("smtp_port", event.target.value)}
              required
            />
          </Field>
          <Field label="Security" htmlFor="smtp-security">
            <Select
              id="smtp-security"
              value={form.smtp_security}
              onChange={(event) => update("smtp_security", event.target.value)}
            >
              <option value="starttls">STARTTLS (port 587)</option>
              <option value="tls">SSL/TLS (port 465)</option>
              <option value="none">No encryption</option>
            </Select>
          </Field>
          <Field label="Authentication" htmlFor="smtp-auth" className="sm:col-span-2">
            <Select
              id="smtp-auth"
              value={form.smtp_auth}
              onChange={(event) => update("smtp_auth", event.target.value)}
            >
              <option value="plain">PLAIN</option>
              <option value="login">LOGIN</option>
              <option value="none">None</option>
            </Select>
          </Field>
          {form.smtp_auth !== "none" ? (
            <>
              <Field label="Username" htmlFor="smtp-username">
                <Input
                  id="smtp-username"
                  autoComplete="off"
                  value={form.smtp_username}
                  onChange={(event) => update("smtp_username", event.target.value)}
                  required
                />
              </Field>
              <Field
                label="Password"
                hint={domain?.has_password ? "Leave blank to keep the current password." : undefined}
                htmlFor="smtp-password"
              >
                <Input
                  id="smtp-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.smtp_password}
                  onChange={(event) => update("smtp_password", event.target.value)}
                  required={!domain?.has_password}
                />
              </Field>
            </>
          ) : null}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500">
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-zinc-600" />
          SMTP credentials are encrypted with AES-256-GCM before being stored. Use port 587 with
          STARTTLS or 465 with implicit TLS.
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-[#1f1f24] pt-5">
        <p className="text-[11px] text-zinc-600">
          {domain ? "You'll need to re-test the connection after changing SMTP settings." : "You'll test the connection after saving."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {domain ? "Save changes" : "Add domain"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function TestDomainModal({
  domain,
  defaultEmail,
  onClose,
  onComplete,
}: {
  domain: Domain | null;
  defaultEmail: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [to, setTo] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const close = () => {
    if (loading) return;
    setError("");
    setSuccess("");
    setTo(defaultEmail);
    onClose();
  };

  const test = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!domain) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<{ message: string }>(`/domains/${domain.id}/test`, {
        method: "POST",
        body: { to },
      });
      setSuccess(result.message || `Test email sent to ${to}`);
      toast.success("SMTP connection verified");
      await onComplete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "SMTP test failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={Boolean(domain)}
      onClose={close}
      title="Test SMTP connection"
      description={`Send a real test email through ${domain?.name || "this domain"}.`}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={loading}>
            {success ? "Close" : "Cancel"}
          </Button>
          {!success ? (
            <Button type="submit" form="smtp-test-form" loading={loading}>
              {loading ? "Connecting…" : "Send test email"}
            </Button>
          ) : null}
        </>
      }
    >
      <form id="smtp-test-form" onSubmit={test} className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3">
            <XCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
            <p className="break-words text-[12px] leading-relaxed text-rose-300">{error}</p>
          </div>
        ) : null}
        {success ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <div>
              <p className="text-[13px] font-medium text-emerald-200">Connection verified</p>
              <p className="mt-0.5 text-[12px] text-emerald-300/60">{success}</p>
            </div>
          </div>
        ) : null}
        <Field label="Test recipient" hint="We'll send a real message to verify SMTP authentication." htmlFor="test-to">
          <Input
            id="test-to"
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
            disabled={loading || Boolean(success)}
          />
        </Field>
        <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3.5">
          <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Connection</p>
          <p className="mt-1.5 font-mono text-[11.5px] text-zinc-400">
            {domain?.smtp_host}:{domain?.smtp_port} · {domain?.smtp_security.toUpperCase()} ·{" "}
            {domain?.smtp_auth === "none" ? "NO AUTH" : domain?.smtp_auth.toUpperCase()}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            This can take up to 45 seconds while we connect to your server.
          </p>
        </div>
      </form>
    </Modal>
  );
}

function DNSModal({ domain, onClose }: { domain: Domain | null; onClose: () => void }) {
  const { data, error, isLoading } = useSWR<DNSResult>(
    domain ? `/domains/${domain.id}/dns` : null,
    fetcher,
  );

  return (
    <Modal
      open={Boolean(domain)}
      onClose={onClose}
      title="DNS diagnostics"
      description={`Optional deliverability checks for ${domain?.name || ""}.`}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg border border-[#26262b] bg-[#0b0b0e]" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
          Could not run DNS checks.
        </div>
      ) : data ? (
        <div className="space-y-3">
          {data.checks.map((check) => (
            <div key={check.type} className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {check.type}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">{check.name}</span>
                </div>
                {check.found ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <CheckCircle2 className="size-3" /> Found
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                    <AlertTriangle className="size-3" /> Missing
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{check.description}</p>
              {check.values && check.values.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {check.values.map((value) => (
                    <p key={value} className="break-all rounded bg-black/30 px-2 py-1.5 font-mono text-[10.5px] text-zinc-400">
                      {value}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <div className="flex items-start gap-2 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] p-3 text-[11px] leading-relaxed text-violet-200/60">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
            {data.note}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

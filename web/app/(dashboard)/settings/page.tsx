"use client";

import Link from "next/link";
import { BookOpen, Building2, Check, KeyRound, LockKeyhole, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError, PUBLIC_API_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Session } from "@/lib/types";
import { PageHeader, PageLoading } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export default function SettingsPage() {
  const { session, mutate, isLoading } = useSession();
  if (isLoading || !session) return <PageLoading />;
  return <SettingsContent session={session} refresh={mutate} />;
}

function SettingsContent({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<unknown>;
}) {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage your profile, workspace name and account security."
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <ProfileForm session={session} refresh={refresh} />
          <WorkspaceForm session={session} refresh={refresh} />
          <PasswordForm />
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex size-9 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
              <ShieldCheck className="size-4 text-violet-300" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-zinc-100">Your account</h2>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Email</dt>
                <dd className="mt-1 break-all text-[12px] text-zinc-300">{session.user.email}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Workspace</dt>
                <dd className="mt-1 text-[12px] text-zinc-300">{session.workspace.name}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Workspace ID</dt>
                <dd className="mt-1 break-all font-mono text-[10.5px] text-zinc-500">{session.workspace.id}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">API base URL</dt>
                <dd className="mt-1 break-all font-mono text-[10.5px] text-zinc-500">{PUBLIC_API_URL}/api/v1</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-5">
            <div className="flex size-9 items-center justify-center rounded-lg border border-[#2a2a2f] bg-white/[0.03]">
              <BookOpen className="size-4 text-zinc-500" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-zinc-100">Need help?</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              Review the API reference for sending email, managing contacts and verifying webhooks.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Link href="/docs">
                <Button variant="secondary" size="sm" className="w-full">
                  API reference
                </Button>
              </Link>
              <Link href="/domains">
                <Button variant="ghost" size="sm" className="w-full">
                  Manage sending domains
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ session, refresh }: { session: Session; refresh: () => Promise<unknown> }) {
  const [name, setName] = useState(session.user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/profile", { method: "PATCH", body: { name: name.trim() } });
      toast.success("Profile updated");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update your profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-[#1e1e22] px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg border border-[#2a2a2f] bg-white/[0.025]">
          <User className="size-3.5 text-zinc-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Profile</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">How your name appears across the workspace.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="space-y-4 p-5">
          {error ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[12.5px] text-rose-300">
              {error}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="profile-name">
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
              />
            </Field>
            <Field label="Email" hint="Contact your administrator to change your email." htmlFor="profile-email">
              <Input id="profile-email" type="email" value={session.user.email} disabled />
            </Field>
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-[#1e1e22] px-5 py-3.5">
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === session.user.name}>
            <Check className="size-4" />
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WorkspaceForm({ session, refresh }: { session: Session; refresh: () => Promise<unknown> }) {
  const [name, setName] = useState(session.workspace.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/workspace", { method: "PATCH", body: { name: name.trim() } });
      toast.success("Workspace updated");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-[#1e1e22] px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg border border-[#2a2a2f] bg-white/[0.025]">
          <Building2 className="size-3.5 text-zinc-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Workspace</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">The name shown in the sidebar and API metadata.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="space-y-4 p-5">
          {error ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[12.5px] text-rose-300">
              {error}
            </div>
          ) : null}
          <Field label="Workspace name" htmlFor="workspace-name">
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end border-t border-[#1e1e22] px-5 py-3.5">
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === session.workspace.name}>
            <Check className="size-4" />
            Save workspace
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await api("/profile/password", {
        method: "POST",
        body: { current_password: currentPassword, new_password: newPassword },
      });
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change your password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-[#1e1e22] px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg border border-[#2a2a2f] bg-white/[0.025]">
          <KeyRound className="size-3.5 text-zinc-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Password</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Use at least 8 characters. Existing sessions stay signed in.
          </p>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="space-y-4 p-5">
          {error ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[12.5px] text-rose-300">
              {error}
            </div>
          ) : null}
          <Field label="Current password" htmlFor="current-password">
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="new-password">
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password">
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </Field>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-600">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-zinc-700" />
            Passwords are hashed with Argon2id and never stored in plain text.
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-[#1e1e22] px-5 py-3.5">
          <Button
            type="submit"
            loading={saving}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

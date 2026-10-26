"use client";

import {
  Building2,
  Globe,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AdminMember, AdminUser, AdminWorkspace, Session } from "@/lib/types";
import { formatDate, initials } from "@/lib/utils";
import { EmptyState, PageHeader, PageLoading, Skeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

type Tab = "users" | "workspaces";
type Overview = { users: number; workspaces: number; domains: number; emails: number };
type UsersResponse = { users: AdminUser[]; total: number };
type WorkspacesResponse = { workspaces: AdminWorkspace[]; total: number };

export default function AdminPage() {
  const { session, isLoading, mutate } = useSession();

  if (isLoading) return <PageLoading />;

  if (!session?.user.is_admin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/[0.06]">
          <ShieldCheck className="size-5 text-rose-300" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-zinc-50">Administrator access required</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          This area is only available to platform administrators. Ask an administrator to promote your account.
        </p>
      </div>
    );
  }

  return <AdminContent session={session} refreshSession={mutate} />;
}

function AdminContent({
  session,
  refreshSession,
}: {
  session: Session;
  refreshSession: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);

  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [renameWorkspace, setRenameWorkspace] = useState<AdminWorkspace | null>(null);
  const [membersWorkspace, setMembersWorkspace] = useState<AdminWorkspace | null>(null);
  const [deleteWorkspace, setDeleteWorkspace] = useState<AdminWorkspace | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = debounced ? `&search=${encodeURIComponent(debounced)}` : "";
  const usersKey = `/admin/users?limit=100${query}`;
  const workspacesKey = `/admin/workspaces?limit=100${query}`;

  const overview = useSWR<Overview>("/admin/overview", fetcher);
  const users = useSWR<UsersResponse>(usersKey, fetcher);
  const workspaces = useSWR<WorkspacesResponse>(workspacesKey, fetcher);
  const allUsers = useSWR<UsersResponse>("/admin/users?limit=200", fetcher);
  const allWorkspaces = useSWR<WorkspacesResponse>("/admin/workspaces?limit=200", fetcher);

  const refreshAll = async () => {
    await Promise.all([
      overview.mutate(),
      users.mutate(),
      workspaces.mutate(),
      allUsers.mutate(),
      allWorkspaces.mutate(),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Platform admin"
        description="Manage every account and workspace on this SendMe instance."
        actions={
          tab === "users" ? (
            <Button onClick={() => setCreateUserOpen(true)}>
              <UserPlus className="size-4" />
              New user
            </Button>
          ) : (
            <Button onClick={() => setCreateWorkspaceOpen(true)}>
              <Plus className="size-4" />
              New workspace
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Users className="size-4" />} label="Users" value={overview.data?.users} loading={overview.isLoading} />
        <StatCard icon={<Building2 className="size-4" />} label="Workspaces" value={overview.data?.workspaces} loading={overview.isLoading} />
        <StatCard icon={<Globe className="size-4" />} label="Domains" value={overview.data?.domains} loading={overview.isLoading} />
        <StatCard icon={<Send className="size-4" />} label="Emails" value={overview.data?.emails} loading={overview.isLoading} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#1e1e22] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex rounded-lg border border-[#26262b] bg-[#0b0b0e] p-0.5" role="group" aria-label="Administration view">
            {(["users", "workspaces"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                  setSearch("");
                }}
                className={
                  tab === value
                    ? "rounded-md bg-white/[0.08] px-3 py-1.5 text-[12px] font-medium capitalize text-zinc-100 shadow-sm"
                    : "rounded-md px-3 py-1.5 text-[12px] font-medium capitalize text-zinc-500 transition hover:text-zinc-300"
                }
              >
                {value}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${tab}…`}
              aria-label={`Search ${tab}`}
              className="h-9 pl-9 text-[13px]"
            />
          </div>
        </div>

        {tab === "users" ? (
          <UsersPanel
            data={users.data}
            error={users.error}
            isLoading={users.isLoading}
            onRetry={() => users.mutate()}
            currentUserId={session.user.id}
            onEdit={setEditUser}
            onResetPassword={setResetPasswordUser}
            onDelete={setDeleteUser}
            onCreate={() => setCreateUserOpen(true)}
          />
        ) : (
          <WorkspacesPanel
            data={workspaces.data}
            error={workspaces.error}
            isLoading={workspaces.isLoading}
            currentWorkspaceId={session.workspace.id}
            onRetry={() => workspaces.mutate()}
            onRename={setRenameWorkspace}
            onMembers={setMembersWorkspace}
            onDelete={setDeleteWorkspace}
            onCreate={() => setCreateWorkspaceOpen(true)}
          />
        )}
      </Card>

      {createUserOpen ? (
        <CreateUserModal
          open
          onClose={() => setCreateUserOpen(false)}
          workspaces={allWorkspaces.data?.workspaces || []}
          onSaved={refreshAll}
        />
      ) : null}
      {editUser ? (
        <EditUserModal
          key={editUser.id}
          user={editUser}
          currentUserId={session.user.id}
          onClose={() => setEditUser(null)}
          onSaved={async () => {
            await refreshAll();
            await refreshSession();
          }}
        />
      ) : null}
      {resetPasswordUser ? (
        <ResetPasswordModal
          user={resetPasswordUser}
          currentUserId={session.user.id}
          onClose={() => setResetPasswordUser(null)}
        />
      ) : null}
      {deleteUser ? (
        <DeleteUserModal
          user={deleteUser}
          currentUserId={session.user.id}
          onClose={() => setDeleteUser(null)}
          onSaved={refreshAll}
        />
      ) : null}

      {createWorkspaceOpen ? (
        <CreateWorkspaceModal
          open
          onClose={() => setCreateWorkspaceOpen(false)}
          users={allUsers.data?.users || []}
          onSaved={refreshAll}
        />
      ) : null}
      {renameWorkspace ? (
        <RenameWorkspaceModal
          workspace={renameWorkspace}
          onClose={() => setRenameWorkspace(null)}
          onSaved={refreshAll}
        />
      ) : null}
      {membersWorkspace ? (
        <MembersModal
          workspace={membersWorkspace}
          currentUserId={session.user.id}
          currentWorkspaceId={session.workspace.id}
          onClose={() => setMembersWorkspace(null)}
          onSaved={refreshAll}
        />
      ) : null}
      {deleteWorkspace ? (
        <DeleteWorkspaceModal
          workspace={deleteWorkspace}
          currentWorkspaceId={session.workspace.id}
          onClose={() => setDeleteWorkspace(null)}
          onSaved={refreshAll}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  loading: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">{label}</p>
        <span className="text-zinc-600">{icon}</span>
      </div>
      {loading ? <Skeleton className="mt-3 h-7 w-16" /> : <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{value ?? 0}</p>}
    </Card>
  );
}

function UsersPanel({
  data,
  error,
  isLoading,
  onRetry,
  currentUserId,
  onEdit,
  onResetPassword,
  onDelete,
  onCreate,
}: {
  data?: UsersResponse;
  error: unknown;
  isLoading: boolean;
  onRetry: () => void;
  currentUserId: string;
  onEdit: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
  onCreate: () => void;
}) {
  if (error) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-zinc-300">Could not load users.</p>
        <p className="mt-1 text-xs text-zinc-500">{error instanceof ApiError ? error.message : "Check the API connection and try again."}</p>
        <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-1 p-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 rounded-lg p-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const users = data?.users || [];
  if (users.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="No users found"
        description="Create the first platform user or adjust your search."
        action={<Button onClick={onCreate}><UserPlus className="size-4" />New user</Button>}
      />
    );
  }
  return (
    <>
      <div className="hidden xl:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Access</th>
              <th className="px-4 py-3 font-medium">Workspaces</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a1a1e]">
            {users.map((user) => (
              <tr key={user.id} className="transition hover:bg-white/[0.022]">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                      {initials(user.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-zinc-200">
                        {user.name}
                        {user.id === currentUserId ? <span className="ml-2 text-[10px] font-normal text-zinc-600">you</span> : null}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  {user.is_admin ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-violet-300">
                      <ShieldCheck className="size-3" /> Admin
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-600">User</span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <div className="flex max-w-[280px] flex-wrap gap-1">
                    {user.workspaces.length === 0 ? (
                      <span className="text-[11px] text-zinc-600">None</span>
                    ) : (
                      user.workspaces.map((workspace) => (
                        <span key={workspace.id} className="rounded border border-[#2a2a2f] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-zinc-400" title={workspace.role}>
                          {workspace.name}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-[11px] text-zinc-500">{formatDate(user.created_at)}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8 text-zinc-500" onClick={() => onEdit(user)} aria-label={`Edit ${user.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-zinc-500" onClick={() => onResetPassword(user)} aria-label={`Reset password for ${user.name}`}>
                      <KeyRound className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-zinc-600 hover:text-rose-300"
                      onClick={() => onDelete(user)}
                      disabled={user.id === currentUserId}
                      aria-label={`Delete ${user.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-[#1a1a1e] xl:hidden">
        {users.map((user) => (
          <div key={user.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                {initials(user.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-zinc-200">{user.name}</p>
                  {user.is_admin ? <span className="rounded-full border border-violet-500/20 bg-violet-500/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-violet-300">Admin</span> : null}
                  {user.id === currentUserId ? <span className="text-[10px] text-zinc-600">you</span> : null}
                </div>
                <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  {user.workspaces.length} workspace{user.workspaces.length === 1 ? "" : "s"} · joined {formatDate(user.created_at)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => onEdit(user)}><Pencil className="size-3.5" />Edit</Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => onResetPassword(user)}><KeyRound className="size-3.5" />Password</Button>
              <Button variant="ghost" size="icon" className="size-8 text-zinc-600 hover:text-rose-300" onClick={() => onDelete(user)} disabled={user.id === currentUserId} aria-label={`Delete ${user.name}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function WorkspacesPanel({
  data,
  error,
  isLoading,
  currentWorkspaceId,
  onRetry,
  onRename,
  onMembers,
  onDelete,
  onCreate,
}: {
  data?: WorkspacesResponse;
  error: unknown;
  isLoading: boolean;
  currentWorkspaceId: string;
  onRetry: () => void;
  onRename: (workspace: AdminWorkspace) => void;
  onMembers: (workspace: AdminWorkspace) => void;
  onDelete: (workspace: AdminWorkspace) => void;
  onCreate: () => void;
}) {
  if (error) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-zinc-300">Could not load workspaces.</p>
        <p className="mt-1 text-xs text-zinc-500">{error instanceof ApiError ? error.message : "Check the API connection and try again."}</p>
        <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-1 p-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 rounded-lg p-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const workspaces = data?.workspaces || [];
  if (workspaces.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="size-5" />}
        title="No workspaces found"
        description="Create a workspace and assign an owner to get started."
        action={<Button onClick={onCreate}><Plus className="size-4" />New workspace</Button>}
      />
    );
  }
  return (
    <>
      <div className="hidden xl:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
              <th className="px-5 py-3 font-medium">Workspace</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Members</th>
              <th className="px-4 py-3 font-medium">Domains</th>
              <th className="px-4 py-3 font-medium">Emails</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a1a1e]">
            {workspaces.map((workspace) => (
              <tr key={workspace.id} className="transition hover:bg-white/[0.022]">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
                      <Building2 className="size-3.5 text-zinc-500" />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-zinc-200">
                        {workspace.name}
                        {workspace.id === currentWorkspaceId ? <span className="ml-2 text-[10px] font-normal text-zinc-600">current</span> : null}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-600">{workspace.id.slice(0, 8)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  {workspace.owner ? (
                    <div>
                      <p className="text-[12px] text-zinc-300">{workspace.owner.name}</p>
                      <p className="text-[10px] text-zinc-600">{workspace.owner.email}</p>
                    </div>
                  ) : (
                    <span className="text-[11px] text-rose-300/80">No owner</span>
                  )}
                </td>
                <td className="px-4 py-4 text-[12px] text-zinc-400">{workspace.member_count}</td>
                <td className="px-4 py-4 text-[12px] text-zinc-400">{workspace.domain_count}</td>
                <td className="px-4 py-4 text-[12px] text-zinc-400">{workspace.email_count}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="text-zinc-400" onClick={() => onMembers(workspace)} aria-label={`Manage members of ${workspace.name}`}>
                      <Users className="size-3.5" />Members
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-zinc-500" onClick={() => onRename(workspace)} aria-label={`Rename ${workspace.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-zinc-600 hover:text-rose-300"
                      onClick={() => onDelete(workspace)}
                      disabled={workspace.id === currentWorkspaceId}
                      aria-label={`Delete ${workspace.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-[#1a1a1e] xl:hidden">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#26262b] bg-white/[0.025]">
                <Building2 className="size-3.5 text-zinc-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-zinc-200">
                  {workspace.name}
                  {workspace.id === currentWorkspaceId ? <span className="ml-2 text-[10px] font-normal text-zinc-600">current</span> : null}
                </p>
                <p className="truncate text-[11px] text-zinc-500">{workspace.owner ? `${workspace.owner.name} · ${workspace.owner.email}` : "No owner"}</p>
                <p className="mt-1 text-[10px] text-zinc-600">{workspace.member_count} members · {workspace.domain_count} domains · {workspace.email_count} emails</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => onMembers(workspace)}><Users className="size-3.5" />Members</Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => onRename(workspace)}><Pencil className="size-3.5" />Rename</Button>
              <Button variant="ghost" size="icon" className="size-8 text-zinc-600 hover:text-rose-300" onClick={() => onDelete(workspace)} disabled={workspace.id === currentWorkspaceId} aria-label={`Delete ${workspace.name}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[12.5px] text-rose-300">
      {message}
    </div>
  );
}

function ModalFooter({
  onClose,
  formId,
  submitLabel,
  loading,
  disabled,
}: {
  onClose: () => void;
  formId: string;
  submitLabel: string;
  loading: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
      <Button type="submit" form={formId} loading={loading} disabled={disabled}>{submitLabel}</Button>
    </>
  );
}

function CreateUserModal({
  open,
  onClose,
  workspaces,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: AdminWorkspace[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">(workspaces.length > 0 ? "existing" : "new");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || "");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/admin/users", {
        method: "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
          is_admin: isAdmin,
          workspace_id: mode === "existing" ? workspaceId : undefined,
          workspace_name: mode === "new" ? workspaceName.trim() || undefined : undefined,
          role: mode === "existing" ? role : undefined,
        },
      });
      toast.success("User created");
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create user" description="Add a platform account and place it in a workspace." footer={
      <ModalFooter formId="create-user-form" onClose={onClose} submitLabel="Create user" loading={saving} disabled={!name.trim() || !email.trim() || password.length < 8 || (mode === "existing" && !workspaceId)} />
    }>
      <form id="create-user-form" onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="admin-user-name">
            <Input id="admin-user-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="admin-user-email">
            <Input id="admin-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" />
          </Field>
        </div>
        <Field label="Temporary password" hint="At least 8 characters. Share it securely; the user can change it in Settings." htmlFor="admin-user-password">
          <Input id="admin-user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#26262b] bg-white/[0.02] px-3 py-3">
          <Checkbox checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} className="mt-0.5" />
          <span>
            <span className="block text-[13px] font-medium text-zinc-200">Platform administrator</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">Can manage every user and workspace on this instance.</span>
          </span>
        </label>
        <div className="space-y-3 rounded-lg border border-[#26262b] bg-white/[0.015] p-3">
          <p className="text-[12px] font-medium text-zinc-300">Workspace</p>
          {workspaces.length > 0 ? (
            <div className="flex gap-2">
              <button type="button" aria-pressed={mode === "existing"} onClick={() => setMode("existing")} className={mode === "existing" ? "flex-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[12px] text-violet-200" : "flex-1 rounded-md border border-[#2a2a2f] px-3 py-2 text-[12px] text-zinc-500 hover:text-zinc-300"}>Existing</button>
              <button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")} className={mode === "new" ? "flex-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[12px] text-violet-200" : "flex-1 rounded-md border border-[#2a2a2f] px-3 py-2 text-[12px] text-zinc-500 hover:text-zinc-300"}>New workspace</button>
            </div>
          ) : null}
          {mode === "existing" && workspaces.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
              <Select aria-label="Workspace" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </Select>
              <Select aria-label="Workspace role" value={role} onChange={(event) => setRole(event.target.value as "owner" | "member")}>
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </Select>
            </div>
          ) : (
            <Field label="Workspace name" hint="Leave empty to create “<name>'s workspace”." htmlFor="admin-workspace-name">
              <Input id="admin-workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={80} placeholder={name ? `${name}'s workspace` : "Workspace name"} />
            </Field>
          )}
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  currentUserId,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: { name: name.trim(), email: email.trim(), is_admin: isAdmin },
      });
      toast.success("User updated");
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit user" description={user.email} footer={
      <ModalFooter formId="edit-user-form" onClose={onClose} submitLabel="Save changes" loading={saving} disabled={!name.trim() || !email.trim()} />
    }>
      <form id="edit-user-form" onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Full name" htmlFor="edit-user-name">
          <Input id="edit-user-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
        </Field>
        <Field label="Email" htmlFor="edit-user-email">
          <Input id="edit-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <label className={user.id === currentUserId ? "flex cursor-not-allowed items-start gap-3 rounded-lg border border-[#26262b] bg-white/[0.02] px-3 py-3 opacity-70" : "flex cursor-pointer items-start gap-3 rounded-lg border border-[#26262b] bg-white/[0.02] px-3 py-3"}>
          <Checkbox checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} disabled={user.id === currentUserId} className="mt-0.5" />
          <span>
            <span className="block text-[13px] font-medium text-zinc-200">Platform administrator</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">
              {user.id === currentUserId ? "You cannot remove your own administrator access." : "Can manage every user and workspace."}
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  currentUserId,
  onClose,
}: {
  user: AdminUser;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await api(`/admin/users/${user.id}/password`, { method: "POST", body: { password } });
      toast.success("Password reset");
      onClose();
      if (user.id === currentUserId) {
        router.push("/login");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Reset password" description={`Set a new password for ${user.email}. Existing sessions will be signed out.`} footer={
      <ModalFooter formId="reset-password-form" onClose={onClose} submitLabel="Reset password" loading={saving} disabled={password.length < 8} />
    }>
      <form id="reset-password-form" onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        {user.id === currentUserId ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-[12px] text-amber-200">
            Resetting your own password will sign you out of this session.
          </div>
        ) : null}
        <Field label="New password" htmlFor="reset-password">
          <Input id="reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" htmlFor="reset-password-confirm">
          <Input id="reset-password-confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
      </form>
    </Modal>
  );
}

function DeleteUserModal({
  user,
  currentUserId,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    setError("");
    setDeleting(true);
    try {
      await api(`/admin/users/${user.id}`, { method: "DELETE" });
      toast.success("User deleted");
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the user");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Delete user" description={`${user.name} (${user.email}) will lose access immediately.`} footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button variant="danger" loading={deleting} onClick={submit} disabled={user.id === currentUserId}>Delete user</Button>
      </>
    }>
      <FormError message={error} />
      <p className="text-[13px] leading-relaxed text-zinc-500">
        Workspaces remain intact. If this user is the only owner of a workspace, transfer ownership first.
      </p>
    </Modal>
  );
}

function CreateWorkspaceModal({
  open,
  onClose,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  users: AdminUser[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState(users[0]?.id || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/admin/workspaces", { method: "POST", body: { name: name.trim(), owner_user_id: ownerId } });
      toast.success("Workspace created");
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create workspace" description="Create a workspace and assign an owner." footer={
      <ModalFooter formId="create-workspace-form" onClose={onClose} submitLabel="Create workspace" loading={saving} disabled={!name.trim() || !ownerId} />
    }>
      <form id="create-workspace-form" onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Workspace name" htmlFor="new-workspace-name">
          <Input id="new-workspace-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
        </Field>
        <Field label="Owner" hint={users.length === 0 ? "Create a user first." : undefined} htmlFor="new-workspace-owner">
          <Select id="new-workspace-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} required disabled={users.length === 0}>
            {users.length === 0 ? <option value="">No users available</option> : users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function RenameWorkspaceModal({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: AdminWorkspace;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api(`/admin/workspaces/${workspace.id}`, { method: "PATCH", body: { name: name.trim() } });
      toast.success("Workspace renamed");
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename the workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Rename workspace" footer={
      <ModalFooter formId="rename-workspace-form" onClose={onClose} submitLabel="Save name" loading={saving} disabled={!name.trim() || name.trim() === workspace.name} />
    }>
      <form id="rename-workspace-form" onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Workspace name" htmlFor="rename-workspace-name">
          <Input id="rename-workspace-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
        </Field>
      </form>
    </Modal>
  );
}

function MembersModal({
  workspace,
  currentUserId,
  currentWorkspaceId,
  onClose,
  onSaved,
}: {
  workspace: AdminWorkspace;
  currentUserId: string;
  currentWorkspaceId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const key = `/admin/workspaces/${workspace.id}/members`;
  const { data, error, isLoading, mutate } = useSWR<{ members: AdminMember[] }>(key, fetcher);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [formError, setFormError] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState("");

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    setAdding(true);
    try {
      await api(`/admin/workspaces/${workspace.id}/members`, { method: "POST", body: { email: email.trim(), role } });
      toast.success("Member added");
      setEmail("");
      setRole("member");
      await mutate();
      await onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add the member");
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (member: AdminMember) => {
    setFormError("");
    setRemovingId(member.id);
    try {
      await api(`/admin/workspaces/${workspace.id}/members/${member.id}`, { method: "DELETE" });
      toast.success("Member removed");
      await mutate();
      await onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not remove the member");
    } finally {
      setRemovingId("");
    }
  };

  return (
    <Modal open onClose={onClose} title="Workspace members" description={workspace.name} size="lg">
      <div className="space-y-5">
        <FormError message={formError} />
        <form onSubmit={addMember} className="rounded-lg border border-[#26262b] bg-white/[0.015] p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="user@example.com" aria-label="Member email" required className="flex-1" />
            <Select aria-label="Member role" value={role} onChange={(event) => setRole(event.target.value as "owner" | "member")} className="sm:w-32">
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </Select>
            <Button type="submit" loading={adding} disabled={!email.trim()}><UserPlus className="size-4" />Add</Button>
          </div>
          <p className="mt-2 text-[10.5px] text-zinc-600">The user must already have an account. Add or create users from the Users tab.</p>
        </form>

        {error ? (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[12.5px] text-rose-300">
            Could not load members.
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className="divide-y divide-[#1e1e22] overflow-hidden rounded-lg border border-[#26262b]">
            {(data?.members || []).map((member) => {
              const self = member.id === currentUserId && workspace.id === currentWorkspaceId;
              return (
                <div key={member.id} className="flex items-center gap-3 bg-white/[0.012] px-3 py-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                    {initials(member.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-zinc-200">
                      {member.name}
                      {member.is_admin ? <span className="rounded-full border border-violet-500/20 bg-violet-500/[0.08] px-1.5 py-0.5 text-[9px] text-violet-300">Platform admin</span> : null}
                    </p>
                    <p className="truncate text-[10.5px] text-zinc-500">{member.email}</p>
                  </div>
                  <span className="rounded border border-[#2a2a2f] px-1.5 py-0.5 text-[10px] capitalize text-zinc-500">{member.role}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-zinc-600 hover:text-rose-300"
                    onClick={() => removeMember(member)}
                    loading={removingId === member.id}
                    disabled={self}
                    aria-label={`Remove ${member.name}`}
                    title={self ? "You cannot remove yourself from your current workspace" : undefined}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteWorkspaceModal({
  workspace,
  currentWorkspaceId,
  onClose,
  onSaved,
}: {
  workspace: AdminWorkspace;
  currentWorkspaceId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    setError("");
    setDeleting(true);
    try {
      await api(`/admin/workspaces/${workspace.id}`, { method: "DELETE" });
      toast.success("Workspace deleted");
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the workspace");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Delete workspace" description={workspace.name} footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button variant="danger" loading={deleting} onClick={submit} disabled={workspace.id === currentWorkspaceId}>Delete workspace</Button>
      </>
    }>
      <FormError message={error} />
      <p className="text-[13px] leading-relaxed text-zinc-500">
        This permanently deletes the workspace and all of its domains, contacts, campaigns, emails and API keys. This cannot be undone.
      </p>
    </Modal>
  );
}

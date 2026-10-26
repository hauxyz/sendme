"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { api, ApiError, fetcher } from "@/lib/api";
import type { Audience, Contact } from "@/lib/types";
import { cn, formatNumber, formatRelative, initials } from "@/lib/utils";
import { EmptyState, PageHeader, PageLoading, Skeleton } from "@/components/ui/page";
import { Badge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ContactForm } from "@/components/contact-form";
import { AudienceForm } from "@/components/audience-form";
import { ImportContactsModal } from "@/components/import-contacts";

type Tab = "contacts" | "audiences";
const PAGE_SIZE = 25;

export default function ContactsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ContactsContent />
    </Suspense>
  );
}

function ContactsContent() {
  const searchParams = useSearchParams();
  const audienceParam = searchParams.get("audience") || "";
  return <ContactsManager key={audienceParam} initialAudience={audienceParam} />;
}

function ContactsManager({ initialAudience }: { initialAudience: string }) {
  const [tab, setTab] = useState<Tab>("contacts");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [audienceFilter, setAudienceFilter] = useState(initialAudience);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [deleteContactLoading, setDeleteContactLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [audienceOpen, setAudienceOpen] = useState(false);
  const [editingAudience, setEditingAudience] = useState<Audience | null>(null);
  const [deletingAudience, setDeletingAudience] = useState<Audience | null>(null);
  const [deleteAudienceLoading, setDeleteAudienceLoading] = useState(false);

  const [bulkAudienceOpen, setBulkAudienceOpen] = useState(false);
  const [bulkAudienceId, setBulkAudienceId] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkRemoving, setBulkRemoving] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (status !== "all") params.set("status", status);
  if (audienceFilter) params.set("audience_id", audienceFilter);

  const contactsKey = tab === "contacts" ? `/contacts?${params.toString()}` : null;
  const {
    data: contactData,
    error: contactsError,
    isLoading: contactsLoading,
    mutate: mutateContacts,
  } = useSWR<{ contacts: Contact[]; total: number }>(contactsKey, fetcher, {
    keepPreviousData: true,
  });

  const {
    data: audienceData,
    error: audiencesError,
    isLoading: audiencesLoading,
    mutate: mutateAudiences,
  } = useSWR<{ audiences: Audience[] }>("/audiences", fetcher);

  const contacts = useMemo(() => contactData?.contacts || [], [contactData]);
  const total = contactData?.total || 0;
  const audiences = useMemo(() => audienceData?.audiences || [], [audienceData]);
  const selectedAudience = audiences.find((audience) => audience.id === audienceFilter);
  const pageIds = contacts.map((contact) => contact.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const resetFilters = () => {
    setSearch("");
    setStatus("all");
    setAudienceFilter("");
    setOffset(0);
    setSelected(new Set());
  };

  const openCreateContact = () => {
    setEditingContact(null);
    setContactOpen(true);
  };

  const openEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setContactOpen(true);
  };

  const deleteContact = async () => {
    if (!deletingContact) return;
    setDeleteContactLoading(true);
    try {
      await api(`/contacts/${deletingContact.id}`, { method: "DELETE" });
      toast.success("Contact deleted");
      setSelected((current) => {
        const next = new Set(current);
        next.delete(deletingContact.id);
        return next;
      });
      setDeletingContact(null);
      await Promise.all([mutateContacts(), mutateAudiences()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the contact");
    } finally {
      setDeleteContactLoading(false);
    }
  };

  const deleteAudience = async () => {
    if (!deletingAudience) return;
    setDeleteAudienceLoading(true);
    try {
      await api(`/audiences/${deletingAudience.id}`, { method: "DELETE" });
      toast.success("Audience deleted");
      if (audienceFilter === deletingAudience.id) {
        setAudienceFilter("");
        setOffset(0);
        setSelected(new Set());
      }
      setDeletingAudience(null);
      await Promise.all([mutateAudiences(), mutateContacts()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the audience");
    } finally {
      setDeleteAudienceLoading(false);
    }
  };

  const viewAudience = (audience: Audience) => {
    setTab("contacts");
    setAudienceFilter(audience.id);
    setStatus("all");
    setOffset(0);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const openBulkAdd = () => {
    setBulkAudienceId(audienceFilter || audiences[0]?.id || "");
    setBulkAudienceOpen(true);
  };

  const addSelectedToAudience = async () => {
    if (!bulkAudienceId || selected.size === 0) return;
    setBulkAdding(true);
    try {
      const result = await api<{ added: number }>(`/audiences/${bulkAudienceId}/contacts`, {
        method: "POST",
        body: { contact_ids: Array.from(selected) },
      });
      toast.success(
        `${formatNumber(result.added)} contact${result.added === 1 ? "" : "s"} added to the audience`,
      );
      setBulkAudienceOpen(false);
      setSelected(new Set());
      await Promise.all([mutateAudiences(), mutateContacts()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add contacts to the audience");
    } finally {
      setBulkAdding(false);
    }
  };

  const removeSelectedFromAudience = async () => {
    if (!audienceFilter || selected.size === 0) return;
    setBulkRemoving(true);
    try {
      await Promise.all(
        Array.from(selected).map((contactId) =>
          api(`/audiences/${audienceFilter}/contacts/${contactId}`, { method: "DELETE" }),
        ),
      );
      toast.success(
        `${formatNumber(selected.size)} contact${selected.size === 1 ? "" : "s"} removed from ${selectedAudience?.name || "the audience"}`,
      );
      setBulkRemoveOpen(false);
      setSelected(new Set());
      await Promise.all([mutateAudiences(), mutateContacts()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove contacts from the audience");
    } finally {
      setBulkRemoving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Manage your audience, import subscribers and keep your contact lists in sync."
        actions={
          tab === "contacts" ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                Import CSV
              </Button>
              <Button onClick={openCreateContact}>
                <UserPlus className="size-4" />
                Add contact
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                setEditingAudience(null);
                setAudienceOpen(true);
              }}
            >
              <Plus className="size-4" />
              New audience
            </Button>
          )
        }
      />

      <div className="mb-6 flex items-center gap-1 rounded-xl border border-[#232327] bg-[#0f0f12] p-1" role="group" aria-label="Contacts view">
        <button
          type="button"
          aria-pressed={tab === "contacts"}
          onClick={() => setTab("contacts")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition sm:flex-none",
            tab === "contacts"
              ? "bg-white/[0.07] text-zinc-100"
              : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300",
          )}
        >
          <Mail className="size-3.5" />
          Contacts
          <span className="rounded bg-white/[0.06] px-1.5 text-[10px] text-zinc-500">
            {tab === "contacts" && contactData ? formatNumber(total) : "—"}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={tab === "audiences"}
          onClick={() => setTab("audiences")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition sm:flex-none",
            tab === "audiences"
              ? "bg-white/[0.07] text-zinc-100"
              : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300",
          )}
        >
          <Users className="size-3.5" />
          Audiences
          <span className="rounded bg-white/[0.06] px-1.5 text-[10px] text-zinc-500">
            {audienceData ? audiences.length : "—"}
          </span>
        </button>
      </div>

      {tab === "contacts" ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[#1e1e22] p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <div className="relative w-full sm:max-w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search email or name…"
                  aria-label="Search contacts"
                  className="h-9 pl-9 pr-8 text-[13px]"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-300"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <Select
                value={audienceFilter}
                onChange={(event) => {
                  setAudienceFilter(event.target.value);
                  setOffset(0);
                  setSelected(new Set());
                }}
                className="h-9 w-full text-[12px] sm:w-56"
                aria-label="Filter by audience"
              >
                <option value="">All audiences</option>
                {audiences.map((audience) => (
                  <option key={audience.id} value={audience.id}>
                    {audience.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto" role="group" aria-label="Filter contacts by subscription status">
              {[
                { value: "all", label: "All" },
                { value: "subscribed", label: "Subscribed" },
                { value: "unsubscribed", label: "Unsubscribed" },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={status === filter.value}
                  onClick={() => {
                    setStatus(filter.value);
                    setOffset(0);
                    setSelected(new Set());
                  }}
                  className={cn(
                    "whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                    status === filter.value
                      ? "bg-white/[0.07] text-zinc-100"
                      : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300",
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {audienceFilter ? (
            <div className="flex items-center justify-between gap-3 border-b border-[#1e1e22] bg-violet-500/[0.025] px-4 py-2">
              <p className="truncate text-[11px] text-violet-200/60">
                Showing contacts in <span className="text-violet-200">{selectedAudience?.name || "this audience"}</span>
                {selectedAudience ? ` · ${formatNumber(selectedAudience.subscribed_count)} subscribed` : ""}
              </p>
              <button
                type="button"
                onClick={() => {
                  setAudienceFilter("");
                  setOffset(0);
                  setSelected(new Set());
                }}
                className="inline-flex items-center gap-1 text-[11px] text-violet-300/70 transition hover:text-violet-200"
              >
                <X className="size-3" />
                Clear
              </button>
            </div>
          ) : null}

          {selected.size > 0 ? (
            <div className="flex flex-col gap-2 border-b border-violet-500/15 bg-violet-500/[0.04] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-violet-200">
                {formatNumber(selected.size)} selected
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="ml-2 text-[11px] text-violet-300/60 underline-offset-2 hover:text-violet-200 hover:underline"
                >
                  Clear
                </button>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={openBulkAdd}>
                  <UserPlus className="size-3.5" />
                  Add to audience
                </Button>
                {audienceFilter ? (
                  <Button size="sm" variant="ghost" onClick={() => setBulkRemoveOpen(true)}>
                    <UserMinus className="size-3.5" />
                    Remove from audience
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {contactsLoading && !contactData ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="flex items-center gap-4 px-2 py-3">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          ) : contactsError ? (
            <EmptyState
              icon={<RefreshCw className="size-5" />}
              title="Couldn't load contacts"
              description={contactsError instanceof ApiError ? contactsError.message : "There was a problem reaching the API. Try again."}
              action={
                <Button variant="secondary" onClick={() => mutateContacts()}>
                  <RefreshCw className="size-3.5" />
                  Try again
                </Button>
              }
            />
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title={
                debouncedSearch || status !== "all" || audienceFilter
                  ? "No matching contacts"
                  : "No contacts yet"
              }
              description={
                debouncedSearch || status !== "all" || audienceFilter
                  ? "Try a different search or clear the filters."
                  : "Add contacts individually or import a CSV to start building your audience."
              }
              action={
                debouncedSearch || status !== "all" || audienceFilter ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button variant="secondary" onClick={() => setImportOpen(true)}>
                      <Upload className="size-4" />
                      Import CSV
                    </Button>
                    <Button onClick={openCreateContact}>
                      <UserPlus className="size-4" />
                      Add contact
                    </Button>
                  </div>
                )
              }
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[840px] text-left">
                  <thead>
                    <tr className="border-b border-[#1b1b1f] text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                      <th className="w-12 px-4 py-3">
                        <Checkbox
                          checked={allSelected}
                          onChange={togglePage}
                          aria-label="Select all contacts on this page"
                        />
                      </th>
                      <th className="px-2 py-3 font-medium">Contact</th>
                      <th className="px-4 py-3 font-medium">Audiences</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Added</th>
                      <th className="w-24 px-5 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1e]">
                    {contacts.map((contact) => {
                      const displayName =
                        [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email;
                      return (
                        <tr key={contact.id} className="group transition hover:bg-white/[0.022]">
                          <td className="px-4 py-3.5">
                            <Checkbox
                              checked={selected.has(contact.id)}
                              onChange={() => toggleSelected(contact.id)}
                              aria-label={`Select ${contact.email}`}
                            />
                          </td>
                          <td className="px-2 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#2a2a2f] bg-white/[0.035] text-[10px] font-semibold text-zinc-400">
                                {initials(displayName)}
                              </div>
                              <div className="min-w-0">
                                <p className="max-w-[260px] truncate text-[13px] font-medium text-zinc-200">
                                  {displayName}
                                </p>
                                {displayName !== contact.email ? (
                                  <p className="max-w-[260px] truncate text-[11px] text-zinc-600">
                                    {contact.email}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {contact.audiences.length === 0 ? (
                              <span className="text-[11px] text-zinc-700">No audience</span>
                            ) : (
                              <div className="flex max-w-[260px] flex-wrap gap-1">
                                {contact.audiences.slice(0, 2).map((audience) => (
                                  <span
                                    key={audience.id}
                                    className="max-w-[110px] truncate rounded-md border border-[#2a2a2f] bg-white/[0.025] px-1.5 py-0.5 text-[10px] text-zinc-400"
                                  >
                                    {audience.name}
                                  </span>
                                ))}
                                {contact.audiences.length > 2 ? (
                                  <span className="rounded-md border border-[#2a2a2f] px-1.5 py-0.5 text-[10px] text-zinc-600">
                                    +{contact.audiences.length - 2}
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <Badge tone={contact.unsubscribed ? "zinc" : "mint"} dot>
                              {contact.unsubscribed ? "Unsubscribed" : "Subscribed"}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-right text-[11px] text-zinc-500">
                            <span title={new Date(contact.created_at).toLocaleString()}>
                              {formatRelative(contact.created_at)}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-end gap-0.5 opacity-70 transition group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => openEditContact(contact)}
                                aria-label={`Edit ${contact.email}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-zinc-600 hover:text-rose-300"
                                onClick={() => setDeletingContact(contact)}
                                aria-label={`Delete ${contact.email}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="xl:hidden">
                <div className="flex items-center gap-3 border-b border-[#1e1e22] px-4 py-2.5">
                  <Checkbox
                    checked={allSelected}
                    onChange={togglePage}
                    aria-label="Select all contacts on this page"
                  />
                  <span className="text-[11px] text-zinc-500">
                    {allSelected ? "Clear page selection" : "Select page"}
                  </span>
                </div>
                <div className="divide-y divide-[#1a1a1e]">
                  {contacts.map((contact) => {
                    const displayName =
                      [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email;
                    return (
                      <div key={contact.id} className="p-4">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selected.has(contact.id)}
                            onChange={() => toggleSelected(contact.id)}
                            aria-label={`Select ${contact.email}`}
                            className="mt-1"
                          />
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#2a2a2f] bg-white/[0.035] text-[10px] font-semibold text-zinc-400">
                            {initials(displayName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-zinc-200">{displayName}</p>
                            {displayName !== contact.email ? (
                              <p className="truncate text-[11px] text-zinc-600">{contact.email}</p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge tone={contact.unsubscribed ? "zinc" : "mint"} dot>
                                {contact.unsubscribed ? "Unsubscribed" : "Subscribed"}
                              </Badge>
                              {contact.audiences.length > 0 ? (
                                <span className="truncate text-[10px] text-zinc-600">
                                  {contact.audiences.map((audience) => audience.name).join(", ")}
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-700">No audience</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-[10px] text-zinc-600">Added {formatRelative(contact.created_at)}</span>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditContact(contact)} aria-label={`Edit ${contact.email}`}>
                              <Pencil className="size-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-zinc-600 hover:text-rose-300"
                              onClick={() => setDeletingContact(contact)}
                              aria-label={`Delete ${contact.email}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {total > 0 ? (
                <div className="flex flex-col gap-3 border-t border-[#1e1e22] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] text-zinc-500">
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {formatNumber(total)}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={offset === 0}
                      onClick={() => {
                        setOffset(Math.max(0, offset - PAGE_SIZE));
                        setSelected(new Set());
                      }}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={offset + PAGE_SIZE >= total}
                      onClick={() => {
                        setOffset(offset + PAGE_SIZE);
                        setSelected(new Set());
                      }}
                      aria-label="Next page"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#232327] bg-[#0f0f12] px-5 py-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
              <Users className="size-4 text-violet-300" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-zinc-200">Group contacts into audiences</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
                A contact can belong to multiple audiences. Campaigns send to every subscribed
                contact in the audience you choose.
              </p>
            </div>
          </div>

          {audiencesLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-52 animate-pulse rounded-xl border border-[#232327] bg-[#0f0f12]" />
              ))}
            </div>
          ) : audiencesError ? (
            <Card>
              <EmptyState
                icon={<RefreshCw className="size-5" />}
                title="Couldn't load audiences"
                description={audiencesError instanceof ApiError ? audiencesError.message : "There was a problem reaching the API. Try again."}
                action={
                  <Button variant="secondary" onClick={() => mutateAudiences()}>
                    <RefreshCw className="size-3.5" />
                    Try again
                  </Button>
                }
              />
            </Card>
          ) : audiences.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Users className="size-5" />}
                title="No audiences yet"
                description="Create an audience to group contacts for your next campaign."
                action={
                  <Button
                    onClick={() => {
                      setEditingAudience(null);
                      setAudienceOpen(true);
                    }}
                  >
                    <Plus className="size-4" />
                    New audience
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {audiences.map((audience) => {
                const subscribedPercent =
                  audience.member_count > 0
                    ? Math.round((audience.subscribed_count / audience.member_count) * 100)
                    : 0;
                return (
                  <div
                    key={audience.id}
                    className="flex flex-col rounded-xl border border-[#232327] bg-[#0f0f12] transition hover:border-[#2c2c31]"
                  >
                    <div className="flex-1 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
                            <Users className="size-4 text-violet-300" />
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-[14px] font-semibold text-zinc-100">{audience.name}</h2>
                            <p className="mt-0.5 text-[11px] text-zinc-600">
                              Created {formatRelative(audience.created_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => {
                              setEditingAudience(audience);
                              setAudienceOpen(true);
                            }}
                            aria-label={`Edit ${audience.name}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-zinc-600 hover:text-rose-300"
                            onClick={() => setDeletingAudience(audience)}
                            aria-label={`Delete ${audience.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      <p className="mt-4 line-clamp-2 min-h-[2.2rem] text-[12px] leading-relaxed text-zinc-500">
                        {audience.description || "No description."}
                      </p>

                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Subscribed</p>
                          <p className="mt-1 text-[15px] font-semibold tabular-nums text-zinc-200">
                            {formatNumber(audience.subscribed_count)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">Total</p>
                          <p className="mt-1 text-[15px] font-semibold tabular-nums text-zinc-200">
                            {formatNumber(audience.member_count)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] text-zinc-600">
                          <span>Active subscribers</span>
                          <span>{subscribedPercent}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400"
                            style={{ width: `${subscribedPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 border-t border-[#1e1e22] p-2.5">
                      <Button variant="ghost" size="sm" onClick={() => viewAudience(audience)}>
                        View contacts
                      </Button>
                      <Link href="/campaigns/new" className="ml-auto">
                        <Button variant="ghost" size="sm">
                          New campaign
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title={editingContact ? "Edit contact" : "Add contact"}
        description={
          editingContact
            ? "Update this contact's details, subscription status and audience memberships."
            : "Add a single subscriber and assign them to one or more audiences."
        }
        size="lg"
      >
        <ContactForm
          key={editingContact?.id || "new"}
          contact={editingContact}
          audiences={audiences}
          defaultAudienceId={audienceFilter}
          onCancel={() => setContactOpen(false)}
          onSaved={async () => {
            setContactOpen(false);
            setEditingContact(null);
            await Promise.all([mutateContacts(), mutateAudiences()]);
          }}
        />
      </Modal>

      {importOpen ? (
        <ImportContactsModal
          audiences={audiences}
          defaultAudienceId={audienceFilter}
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await Promise.all([mutateContacts(), mutateAudiences()]);
          }}
        />
      ) : null}

      <Modal
        open={audienceOpen}
        onClose={() => setAudienceOpen(false)}
        title={editingAudience ? "Edit audience" : "New audience"}
        description={
          editingAudience
            ? "Rename this audience or update its description."
            : "Create a list that you can send campaigns to."
        }
      >
        <AudienceForm
          key={editingAudience?.id || "new"}
          audience={editingAudience}
          onCancel={() => setAudienceOpen(false)}
          onSaved={async () => {
            setAudienceOpen(false);
            setEditingAudience(null);
            await mutateAudiences();
          }}
        />
      </Modal>

      <Modal
        open={Boolean(deletingContact)}
        onClose={() => setDeletingContact(null)}
        title="Delete contact?"
        description={`${deletingContact?.email || "This contact"} will be removed from every audience.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingContact(null)} disabled={deleteContactLoading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteContact} loading={deleteContactLoading}>
              Delete contact
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          This removes the contact and their audience memberships. Email history tied to this
          contact is preserved. This action cannot be undone.
        </p>
      </Modal>

      <Modal
        open={Boolean(deletingAudience)}
        onClose={() => setDeletingAudience(null)}
        title="Delete audience?"
        description={`${deletingAudience?.name || "This audience"} will be removed. Contacts themselves are not deleted.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingAudience(null)} disabled={deleteAudienceLoading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteAudience} loading={deleteAudienceLoading}>
              Delete audience
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Any campaigns that reference this audience keep their existing recipient deliveries, but
          you won&apos;t be able to reuse the audience for new campaigns.
        </p>
      </Modal>

      <Modal
        open={bulkAudienceOpen}
        onClose={() => setBulkAudienceOpen(false)}
        title="Add to audience"
        description={`Add ${formatNumber(selected.size)} selected contact${selected.size === 1 ? "" : "s"} to an audience.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkAudienceOpen(false)} disabled={bulkAdding}>
              Cancel
            </Button>
            <Button onClick={addSelectedToAudience} loading={bulkAdding} disabled={!bulkAudienceId}>
              <UserPlus className="size-4" />
              Add contacts
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {audiences.length === 0 ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-[12px] leading-relaxed text-amber-200/70">
                Create an audience first, then you can add contacts to it.
              </p>
            </div>
          ) : (
            <Select
              value={bulkAudienceId}
              onChange={(event) => setBulkAudienceId(event.target.value)}
              aria-label="Audience"
            >
              <option value="">Select an audience</option>
              {audiences.map((audience) => (
                <option key={audience.id} value={audience.id}>
                  {audience.name} — {formatNumber(audience.subscribed_count)} subscribed
                </option>
              ))}
            </Select>
          )}
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Contacts that already belong to the audience are left unchanged. Unsubscribed contacts
            remain unsubscribed.
          </p>
        </div>
      </Modal>

      <Modal
        open={bulkRemoveOpen}
        onClose={() => setBulkRemoveOpen(false)}
        title="Remove from audience"
        description={`Remove ${formatNumber(selected.size)} selected contact${selected.size === 1 ? "" : "s"} from ${selectedAudience?.name || "this audience"}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkRemoveOpen(false)} disabled={bulkRemoving}>
              Cancel
            </Button>
            <Button variant="danger" onClick={removeSelectedFromAudience} loading={bulkRemoving}>
              <UserMinus className="size-4" />
              Remove contacts
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          The contacts stay in your workspace and any other audiences. Only their membership in
          this audience is removed. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

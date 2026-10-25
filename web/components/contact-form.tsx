"use client";

import { AlertTriangle, Check, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Audience, Contact } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Switch } from "@/components/ui/input";

export function ContactForm({
  contact,
  audiences,
  defaultAudienceId = "",
  onCancel,
  onSaved,
}: {
  contact?: Contact | null;
  audiences: Audience[];
  defaultAudienceId?: string;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [email, setEmail] = useState(contact?.email || "");
  const [firstName, setFirstName] = useState(contact?.first_name || "");
  const [lastName, setLastName] = useState(contact?.last_name || "");
  const [subscribed, setSubscribed] = useState(!contact?.unsubscribed);
  const [audienceIds, setAudienceIds] = useState<string[]>(
    contact ? contact.audiences.map((audience) => audience.id) : defaultAudienceId ? [defaultAudienceId] : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleAudience = (id: string) => {
    setAudienceIds((current) =>
      current.includes(id) ? current.filter((audienceId) => audienceId !== id) : [...current, id],
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = {
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      };

      if (contact) {
        await api(`/contacts/${contact.id}`, {
          method: "PATCH",
          body: { ...payload, unsubscribed: !subscribed },
        });

        const original = new Set(contact.audiences.map((audience) => audience.id));
        const next = new Set(audienceIds);
        const add = audienceIds.filter((id) => !original.has(id));
        const remove = contact.audiences.filter((audience) => !next.has(audience.id));

        for (const audienceId of add) {
          await api(`/audiences/${audienceId}/contacts`, {
            method: "POST",
            body: { contact_ids: [contact.id] },
          });
        }
        for (const audience of remove) {
          await api(`/audiences/${audience.id}/contacts/${contact.id}`, { method: "DELETE" });
        }
        toast.success("Contact updated");
      } else {
        await api("/contacts", {
          method: "POST",
          body: { ...payload, audience_ids: audienceIds },
        });
        toast.success("Contact added");
      }

      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email address" htmlFor="contact-email">
          <Input
            id="contact-email"
            type="email"
            placeholder="person@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus={!contact}
          />
        </Field>
        <div className="hidden sm:block" />
        <Field label="First name" hint="Optional." htmlFor="contact-first-name">
          <Input
            id="contact-first-name"
            placeholder="Alex"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="Last name" hint="Optional." htmlFor="contact-last-name">
          <Input
            id="contact-last-name"
            placeholder="Nguyen"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            maxLength={100}
          />
        </Field>
      </div>

      {contact ? (
        <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-3.5">
          <Switch
            checked={subscribed}
            onChange={setSubscribed}
            label="Subscribed"
            description="Unsubscribed contacts are excluded from campaigns and public sends."
          />
        </div>
      ) : null}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-zinc-300">Audiences</h3>
          <span className="text-[11px] text-zinc-600">
            {audienceIds.length} selected
          </span>
        </div>
        {audiences.length === 0 ? (
          <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] px-4 py-3 text-[12px] text-zinc-500">
            No audiences yet. You can create one from the Audiences tab.
          </div>
        ) : (
          <div className="grid max-h-52 gap-1.5 overflow-y-auto rounded-lg border border-[#26262b] bg-[#0b0b0e] p-2 sm:grid-cols-2">
            {audiences.map((audience) => {
              const checked = audienceIds.includes(audience.id);
              return (
                <label
                  key={audience.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 transition",
                    checked
                      ? "border-violet-500/25 bg-violet-500/[0.06]"
                      : "border-transparent hover:bg-white/[0.03]",
                  )}
                >
                  <Checkbox checked={checked} onChange={() => toggleAudience(audience.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-zinc-300">{audience.name}</span>
                    <span className="block text-[10px] text-zinc-600">
                      {audience.subscribed_count.toLocaleString()} subscribed
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between border-t border-[#1f1f24] pt-5">
        <p className="max-w-xs text-[11px] leading-relaxed text-zinc-600">
          We&apos;ll use this address for campaign personalization and delivery.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {contact ? (
              <>
                <Check className="size-4" />
                Save changes
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                Add contact
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

"use client";

import { AlertTriangle, Check, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Audience } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

export function AudienceForm({
  audience,
  onCancel,
  onSaved,
}: {
  audience?: Audience | null;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState(audience?.name || "");
  const [description, setDescription] = useState(audience?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim() };
      if (audience) {
        await api(`/audiences/${audience.id}`, { method: "PATCH", body: payload });
        toast.success("Audience updated");
      } else {
        await api("/audiences", { method: "POST", body: payload });
        toast.success("Audience created");
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the audience.");
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

      <Field label="Audience name" htmlFor="audience-name">
        <Input
          id="audience-name"
          placeholder="Product updates"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={120}
          autoFocus
        />
      </Field>

      <Field label="Description" hint="Optional. Helps your team remember who belongs here." htmlFor="audience-description">
        <Textarea
          id="audience-description"
          rows={3}
          placeholder="People who opted in to monthly product news…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
        />
      </Field>

      <div className="flex items-center justify-between border-t border-[#1f1f24] pt-5">
        <p className="text-[11px] text-zinc-600">
          {audience
            ? `${audience.subscribed_count.toLocaleString()} subscribed · ${audience.member_count.toLocaleString()} total members`
            : "You can add contacts now or later."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {audience ? (
              <>
                <Check className="size-4" />
                Save changes
              </>
            ) : (
              <>
                <Plus className="size-4" />
                Create audience
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

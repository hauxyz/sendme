"use client";

import { AlertTriangle, FileSpreadsheet, Upload, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Audience } from "@/lib/types";
import { formatNumber, parseCSV } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function ImportContactsModal({
  audiences,
  defaultAudienceId = "",
  onClose,
  onImported,
}: {
  audiences: Audience[];
  defaultAudienceId?: string;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [csvText, setCsvText] = useState("");
  const [audienceId, setAudienceId] = useState(defaultAudienceId || audiences[0]?.id || "");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  const parsed = useMemo(() => parseCSV(csvText), [csvText]);
  const tooLarge = parsed.contacts.length > 5000;

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      setError("Could not read that file. Try pasting the CSV contents instead.");
    };
    reader.readAsText(file);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (parsed.contacts.length === 0) {
      setError("Add at least one contact with a valid email address.");
      return;
    }
    if (tooLarge) {
      setError("Import up to 5,000 contacts at a time.");
      return;
    }

    setError("");
    setImporting(true);
    try {
      const result = await api<{ imported: number; skipped: number; invalid: number }>(
        "/contacts/import",
        {
          method: "POST",
          body: {
            contacts: parsed.contacts.map((contact) => ({
              email: contact.email,
              first_name: contact.firstName,
              last_name: contact.lastName,
            })),
            audience_id: audienceId,
          },
        },
      );
      const summary = [
        `${formatNumber(result.imported)} added`,
        result.skipped ? `${formatNumber(result.skipped)} already existed` : null,
        result.invalid ? `${formatNumber(result.invalid)} invalid` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Import complete — ${summary}`);
      await onImported();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import contacts.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !importing && onClose()}
      title="Import contacts"
      description="Upload a CSV or paste comma-separated rows. The first row can contain email, first_name and last_name headers."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button type="submit" form="import-contacts-form" loading={importing} disabled={parsed.contacts.length === 0 || tooLarge}>
            <Upload className="size-4" />
            Import {parsed.contacts.length > 0 ? formatNumber(parsed.contacts.length) : ""} contacts
          </Button>
        </>
      }
    >
      <form id="import-contacts-form" onSubmit={submit} className="space-y-5">
        {error ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-[13px] text-rose-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="rounded-xl border border-[#26262b] bg-[#0b0b0e] p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg border border-violet-500/15 bg-violet-500/[0.06]">
              <FileSpreadsheet className="size-4 text-violet-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-zinc-200">Choose a CSV file</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                {fileName || "email, first_name, last_name"}
              </p>
            </div>
          </div>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => handleFile(event.target.files?.[0])}
            className="mt-3 h-auto cursor-pointer py-2 text-[12px] file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.06] file:px-2.5 file:py-1 file:text-[11px] file:text-zinc-300"
          />
        </div>

        <Field label="Or paste CSV" htmlFor="csv-data">
          <Textarea
            id="csv-data"
            rows={7}
            spellCheck={false}
            placeholder={"email,first_name,last_name\nalex@example.com,Alex,Nguyen\nsam@example.com,Sam,Rivera"}
            value={csvText}
            onChange={(event) => {
              setCsvText(event.target.value);
              setFileName("");
            }}
            className="min-h-40 font-mono text-[12px]"
          />
        </Field>

        <Field label="Add to audience" hint="New and existing contacts will be added to this audience." htmlFor="import-audience">
          <Select
            id="import-audience"
            value={audienceId}
            onChange={(event) => setAudienceId(event.target.value)}
          >
            <option value="">Don&apos;t add to an audience</option>
            {audiences.map((audience) => (
              <option key={audience.id} value={audience.id}>
                {audience.name}
              </option>
            ))}
          </Select>
        </Field>

        {csvText ? (
          <div className="rounded-lg border border-[#26262b] bg-[#0b0b0e] p-4">
            <div className="flex items-center gap-2 text-[12px]">
              <Users className="size-3.5 text-zinc-500" />
              <span className="text-zinc-300">{formatNumber(parsed.contacts.length)} valid contacts</span>
              {parsed.invalid > 0 ? (
                <span className="ml-auto text-amber-300/80">{formatNumber(parsed.invalid)} invalid rows skipped</span>
              ) : null}
            </div>
            {parsed.contacts.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {parsed.contacts.slice(0, 3).map((contact) => (
                  <div key={contact.email} className="flex items-center gap-2 text-[11px]">
                    <span className="size-1 rounded-full bg-zinc-600" />
                    <span className="truncate text-zinc-400">{contact.email}</span>
                    {contact.firstName || contact.lastName ? (
                      <span className="truncate text-zinc-600">
                        {[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
                      </span>
                    ) : null}
                  </div>
                ))}
                {parsed.contacts.length > 3 ? (
                  <p className="pt-1 text-[10.5px] text-zinc-600">
                    and {formatNumber(parsed.contacts.length - 3)} more…
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-600">
                No valid rows detected. Make sure each row contains an email address.
              </p>
            )}
            {tooLarge ? (
              <p className="mt-3 text-[11px] text-rose-300">
                {formatNumber(parsed.contacts.length)} rows detected. Split the file to import up to
                5,000 at a time.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-[#26262b] bg-[#0b0b0e] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-600">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-zinc-700" />
            Duplicate email addresses are skipped. Existing contacts are added to the selected
            audience without overwriting their names.
          </div>
        )}
      </form>
    </Modal>
  );
}

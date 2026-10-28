"use client";

import { startTransition, useActionState } from "react";
import type { FormState } from "@/lib/actions";
import { PendingProvider, SubmitButton } from "./form";
import { Alert, Input } from "./ui";

type RowError = { row: number; column?: string; message: string };

/** CSV upload with row-level error reporting (INT-12, INT-16). */
export function UploadForm({ action, name, label, templateHref }: { action: (s: FormState, fd: FormData) => Promise<FormState>; name: string; label: string; templateHref: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const data = state?.data as { errors?: RowError[]; warnings?: RowError[] } | undefined;
  return (
    <PendingProvider value={pending}>
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
          <Input type="file" name={name} accept=".csv,text/csv" />
        </div>
        <SubmitButton pending="Uploading…">Upload</SubmitButton>
        <a href={templateHref} className="text-sm text-brand underline">
          Download template
        </a>
      </div>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.ok && <Alert tone="ok">{state.ok}</Alert>}
      {data?.errors && data.errors.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-danger/30 bg-danger-light p-3 text-xs text-danger">
          {data.errors.map((e, i) => (
            <li key={i}>
              {e.row > 0 ? `Row ${e.row}` : "File"}
              {e.column ? ` · ${e.column}` : ""}: {e.message}
            </li>
          ))}
        </ul>
      )}
      {data?.warnings && data.warnings.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-warn/30 bg-warn-light p-3 text-xs text-warn">
          {data.warnings.map((e, i) => (
            <li key={i}>
              Row {e.row}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </form>
    </PendingProvider>
  );
}

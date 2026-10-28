"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { consentAction, withdrawAction } from "./actions";

export function ConsentForm({ token, email, hasConsent }: { token: string; email: string; hasConsent: boolean }) {
  const [opened, setOpened] = useState(false);
  const [state, action, pending] = useActionState(consentAction.bind(null, token), undefined);
  const [wState, withdraw, wPending] = useActionState(withdrawAction.bind(null, token), undefined);
  return (
    <Card title="Your choice">
      <form action={action} className="space-y-4">
        {state?.error && <Alert tone="danger">{state.error}</Alert>}
        {state?.ok && <Alert tone="ok">{state.ok}</Alert>}
        <Field label="Personal email (not your work email)" hint="You may lose access to your work email when you leave.">
          <Input type="email" name="email" defaultValue={email} required />
        </Field>
        <div className="rounded-md border border-line bg-paper p-3 text-sm">
          <p>Step 1: open this test document to confirm you can view PDF files.</p>
          <a href="/api/consent-test" target="_blank" rel="noreferrer" onClick={() => setOpened(true)} className="mt-1 inline-block font-medium text-brand underline">
            Open the test PDF
          </a>
          {opened && <span className="ml-2 text-ok">Opened</span>}
          <input type="hidden" name="testPdfOpened" value={opened ? "yes" : "no"} />
        </div>
        <Button disabled={!opened || pending}>{pending ? "Saving…" : "I consent to receive COBRA notices electronically"}</Button>
      </form>
      {hasConsent && (
        <form action={withdraw} className="mt-6 border-t border-line pt-4">
          {wState?.ok && <Alert tone="ok">{wState.ok}</Alert>}
          <Button variant="secondary" disabled={wPending}>Withdraw consent and get paper notices</Button>
        </form>
      )}
    </Card>
  );
}

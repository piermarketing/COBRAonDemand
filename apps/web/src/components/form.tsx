"use client";

import { createContext, startTransition, useActionState, useContext, type FormEvent, type ReactNode } from "react";
import type { FormState } from "@/lib/actions";
import { Alert, Button } from "./ui";

const PendingContext = createContext(false);
export const PendingProvider = PendingContext.Provider;

export function SubmitButton({ children, pending, variant, className }: { children: ReactNode; pending?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; className?: string }) {
  const isPending = useContext(PendingContext);
  return (
    <Button type="submit" disabled={isPending} variant={variant} className={className}>
      {isPending ? pending ?? "Working…" : children}
    </Button>
  );
}

/**
 * A form bound to a server action, with inline error and success messages.
 * Submits through onSubmit rather than the form's action prop so React
 * doesn't reset the fields when the action returns an error.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={onSubmit} className={className ?? "space-y-4"}>
        {state?.error && <Alert tone="danger">{state.error}</Alert>}
        {state?.ok && <Alert tone="ok">{state.ok}</Alert>}
        {children}
      </form>
    </PendingContext.Provider>
  );
}

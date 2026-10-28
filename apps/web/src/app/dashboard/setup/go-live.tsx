"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { goLiveAction } from "../actions";

export function GoLiveButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(goLiveAction, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <Button disabled={disabled || pending}>{pending ? "Going live…" : "Go live"}</Button>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}

import { UserError } from "@cod/core";

export type FormState = { error?: string; field?: string; ok?: string; data?: unknown } | undefined;

/** Turn known user errors into form state; let real bugs surface. */
export function toFormError(err: unknown): FormState {
  if (err instanceof UserError) return { error: err.message, field: err.field };
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    const issue = (err as { issues: { message: string; path: (string | number)[] }[] }).issues[0];
    return { error: issue?.message ?? "Check the form and try again.", field: issue?.path?.[0]?.toString() };
  }
  if (err && typeof err === "object" && "digest" in err) throw err; // redirect() / notFound()
  if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
  console.error(err);
  return { error: "Something went wrong. Please try again." };
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "yes";
}

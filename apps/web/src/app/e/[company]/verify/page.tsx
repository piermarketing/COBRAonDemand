import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Card, Field, Input } from "@/components/ui";
import { verifyCodeAction } from "../actions";

export default async function Verify({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<{ q?: string; to?: string; dev?: string }> }) {
  const { company } = await params;
  const sp = await searchParams;
  if (!sp.q) redirect(`/e/${company}`);
  return (
    <Card title="Enter your verification code">
      <ActionForm action={verifyCodeAction.bind(null, company, sp.q)}>
        <p className="text-sm text-ink-soft">We sent a 6-digit code to {sp.to}. It expires in 10 minutes.</p>
        {sp.dev && process.env.NODE_ENV !== "production" && <Alert tone="warn" title="Development mode">Your code is {sp.dev}. (Shown only outside production.)</Alert>}
        <Field label="Code">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
        </Field>
        <SubmitButton pending="Verifying…">Verify</SubmitButton>
      </ActionForm>
    </Card>
  );
}

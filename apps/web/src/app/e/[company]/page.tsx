import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { enrolleeLoginAction, startVerificationAction } from "./actions";

export default async function EnrolleeLanding({ params }: { params: Promise<{ company: string }> }) {
  const { company } = await params;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Continue your health coverage</h1>
        <p className="mt-2 text-sm text-ink-soft">Verify your identity to read your COBRA notice, choose coverage for you and your family, and set up payments. It takes about 10 minutes.</p>
      </div>
      <Card title="Verify your identity">
        <ActionForm action={startVerificationAction.bind(null, company)}>
          <Field label="Employee's last day of work (termination date)" hint="It's in your COBRA notice and your departure papers.">
            <Input type="date" name="eventDate" required />
          </Field>
          <Field label="Last 4 digits of the employee's Social Security number">
            <Input name="last4" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" required />
          </Field>
          <Field label="Your date of birth" hint="Spouses and dependents: use your own date of birth.">
            <Input type="date" name="dob" required />
          </Field>
          <SubmitButton pending="Checking…" className="w-full sm:w-auto">
            Send my verification code
          </SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Already have an account?">
        <ActionForm action={enrolleeLoginAction.bind(null, company)}>
          <Field label="Email"><Input type="email" name="email" autoComplete="email" required /></Field>
          <Field label="Password"><Input type="password" name="password" autoComplete="current-password" required /></Field>
          <SubmitButton variant="secondary">Sign in</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

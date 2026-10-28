import { AGREEMENTS } from "@cod/core";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";
import { signUpAction } from "./actions";

export const metadata = { title: "Get started" };

const STATES = ["CA", "AZ", "NV", "OR", "WA", "TX", "NY", "FL", "IL", "CO", "UT", "Other"];

export default function GetStarted() {
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 md:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-3xl font-semibold text-ink">Get started</h1>
        <p className="mt-2 text-ink-soft">A few details about you and your company. Everything else comes from your payroll or benefits platform in the next step.</p>

        <ActionForm action={signUpAction} className="mt-8 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <Input name="contactName" autoComplete="name" required />
            </Field>
            <Field label="Work email">
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Role" hint="For example HR, owner, finance.">
              <Input name="contactRole" required />
            </Field>
            <Field label="Title">
              <Input name="contactTitle" required />
            </Field>
          </div>
          <Field label="Password" hint="At least 12 characters. Multi-factor sign-in is added before go-live.">
            <Input name="password" type="password" autoComplete="new-password" minLength={12} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Company name">
              <Input name="companyName" autoComplete="organization" required />
            </Field>
            <Field label="State">
              <Select name="state" defaultValue="CA">
                {STATES.map((s) => (
                  <option key={s} value={s === "Other" ? "ZZ" : s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Employees in the prior calendar year" hint="Count employees on at least half of your typical business days. Federal COBRA applies at 20 or more.">
            <Input name="priorYearEmployeeCount" type="number" min={0} required />
          </Field>

          <div className="rounded-md border border-line bg-paper p-4">
            <p className="text-sm font-medium text-ink">Agreements</p>
            <p className="mt-1 text-xs text-ink-muted">These must be accepted before any employee data syncs.</p>
            <div className="mt-3 space-y-2">
              {AGREEMENTS.map((a) => (
                <details key={a.type} className="rounded border border-line bg-white px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium text-ink">
                    {a.title} <span className="text-xs font-normal text-ink-muted">({a.version})</span>
                  </summary>
                  <div className="mt-2 space-y-2 text-ink-soft">
                    {a.body.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" name="acceptTerms" className="mt-1" required />
              <span>I accept the Terms and Conditions, the COBRA Administration Service Agreement and the HIPAA Business Associate Agreement.</span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" name="confirmAuthority" className="mt-1" required />
              <span>I confirm I have authority to bind the company to these agreements.</span>
            </label>
          </div>

          <SubmitButton pending="Creating your account…">Create account</SubmitButton>
        </ActionForm>
      </div>

      <aside className="h-fit rounded-lg border border-line bg-paper p-5 text-sm text-ink-soft">
        <p className="font-semibold text-ink">What happens next</p>
        <ol className="mt-3 list-decimal space-y-2 pl-4">
          <li>Connect payroll or benefits, or upload a census file.</li>
          <li>Review the imported plans, rates and elections.</li>
          <li>Add a card or bank account. Nothing is charged until the first packet is sent.</li>
          <li>Go live. Terminations from your payroll start the COBRA process automatically.</li>
        </ol>
      </aside>
    </div>
  );
}

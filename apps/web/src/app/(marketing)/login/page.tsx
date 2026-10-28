import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { loginAction } from "./actions";

export const metadata = { title: "Sign in" };

export default function Login() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
      <p className="mt-2 text-sm text-ink-soft">For employers, brokers and COBRA on Demand staff.</p>
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton pending="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-soft">
        New employer? <Link href="/get-started" className="text-brand underline">Get started</Link>
      </p>
      <p className="mt-2 text-sm text-ink-soft">Former employee looking for your COBRA election? Use the link in your notice or your company&apos;s COBRA page.</p>
    </div>
  );
}

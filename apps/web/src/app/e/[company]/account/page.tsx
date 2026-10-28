import Link from "next/link";
import { getEnrolleeView } from "@cod/core";
import { QB_STATUS_LABELS, type QbStatus } from "@cod/rules";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, Field, Input, Select, Table } from "@/components/ui";
import { requireEnrollee } from "@/lib/auth";
import { date, humanize, money } from "@/lib/format";
import { addMethodAction, createAccountAction, enrolleeLogoutAction, paperCopyAction, payAction } from "../actions";

export const metadata = { title: "Your COBRA account" };

export default async function Account({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<{ confirmed?: string; paid?: string }> }) {
  const { company: slug } = await params;
  const { confirmed, paid } = await searchParams;
  const { session } = await requireEnrollee(slug);
  const v = await getEnrolleeView(session.qbId);
  const invoices = v.invoices.filter((i) => i.status !== "void");
  const paidBy = new Map<string, number>();
  for (const p of v.payments.filter((p) => p.status === "succeeded")) paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.amount);
  const openInvoices = invoices.filter((i) => i.status === "open" || i.status === "shortfall_cure");
  const paidThrough = invoices.filter((i) => i.status === "paid").map((i) => i.periodEnd).sort().at(-1);
  const canStillElect = v.manageable.some((q) => ["notice_sent", "waived"].includes(q.status));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Hello, {v.me.firstName}</h1>
          <p className="mt-1 text-sm text-ink-soft">Your COBRA continuation coverage with {v.company.name}.</p>
        </div>
        <form action={enrolleeLogoutAction.bind(null, slug)}>
          <button className="text-sm text-ink-soft hover:text-ink">Sign out</button>
        </form>
      </div>

      {confirmed && (
        <Alert tone="ok" title={`Election received · confirmation ${confirmed}`}>
          A confirmation has been emailed to you. {openInvoices.length > 0 && "Next: create your account and pay your first premium to reinstate coverage."}
        </Alert>
      )}
      {paid && (
        <Alert tone="ok" title="Payment received. Thank you.">
          {v.household.some((q) => q.status === "active") ? "Your COBRA coverage is active and reinstated back to the day it ended." : "Your payment has been applied."}
        </Alert>
      )}
      {canStillElect && (
        <Alert tone="warn" title="You still have an election to make">
          <Link href={`/e/${slug}/elect`} className="underline">Review your notice and elect</Link> before {date(v.me.electionDeadline, "long")}.
        </Alert>
      )}

      <Card title="Coverage">
        <Table
          headers={["Person", "Status", "COBRA start", "Coverage can last through"]}
          rows={v.household.map((q) => [`${q.firstName} ${q.lastName}`, <Badge key="s" tone={q.status === "active" ? "ok" : q.status === "grace" ? "warn" : "neutral"}>{QB_STATUS_LABELS[q.status as QbStatus] ?? q.status}</Badge>, date(q.cobraStart), date(q.maxCoverageEnd)])}
        />
        {paidThrough && <p className="mt-3 text-sm text-ink-soft">Paid through {date(paidThrough, "long")}.</p>}
      </Card>

      {!v.account ? (
        <Card title="Create your account">
          <ActionForm action={createAccountAction.bind(null, slug)}>
            <p className="text-sm text-ink-soft">Use your account to pay premiums, see your documents and manage coverage. One account covers everyone you elected for.</p>
            <Field label="Email"><Input type="email" name="email" defaultValue={v.me.email ?? ""} autoComplete="email" required /></Field>
            <Field label="Password" hint="At least 10 characters."><Input type="password" name="password" autoComplete="new-password" minLength={10} required /></Field>
            <Field label="Confirm password"><Input type="password" name="confirm" autoComplete="new-password" required /></Field>
            <SubmitButton>Create account</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <>
          <Card title="Premiums">
            {openInvoices.map((i) => (
              <div key={i.id} className="mb-4 rounded-md border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink">
                    {i.kind === "initial" ? "First premium" : "Monthly premium"}: {date(i.periodStart)} – {date(i.periodEnd)}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">{money(i.amountDue - (paidBy.get(i.id) ?? 0))}</p>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Pay by {date(i.finalPaymentDate, "long")}.{i.subsidyAmount > 0 && ` ${v.company.name} is paying ${money(i.subsidyAmount)} of this period.`}
                </p>
                {v.paymentMethods.length > 0 ? (
                  <ActionForm action={payAction.bind(null, slug, i.id)} className="mt-3 flex flex-wrap items-end gap-2">
                    <Select name="methodId" className="w-auto">
                      {v.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.type === "ach" ? "Bank account" : "Card"} ending {m.last4}</option>)}
                    </Select>
                    <SubmitButton pending="Paying…">Pay now</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="mt-2 text-sm text-warn">Add a payment method below to pay.</p>
                )}
              </div>
            ))}
            <Table
              headers={["Period", "Amount", "Company-paid", "Status"]}
              rows={invoices.map((i) => [`${date(i.periodStart)} – ${date(i.periodEnd)}`, money(i.amountDue), money(i.subsidyAmount), humanize(i.status)])}
              empty="No premiums yet."
            />
          </Card>

          <Card title="Payment methods">
            <Table headers={["Method", "Autopay"]} rows={v.paymentMethods.map((m) => [`${m.type === "ach" ? "Bank account" : "Card"} ending ${m.last4}`, m.autopay ? "On" : "Off"])} empty="No payment method yet." />
            <ActionForm action={addMethodAction.bind(null, slug)} className="mt-4 flex flex-wrap items-end gap-3">
              <Field label="Add">
                <Select name="type" defaultValue="ach"><option value="ach">Bank account (ACH)</option><option value="card">Debit or credit card</option></Select>
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="autopay" defaultChecked /> Autopay each month</label>
              <SubmitButton variant="secondary">Add (Stripe test mode)</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-ink-muted">No card convenience fee. Bank and card numbers are entered with our payment processor and never stored by us.</p>
          </Card>
        </>
      )}

      <Card title="Documents">
        <ul className="space-y-2 text-sm">
          {v.notice && (
            <li>
              <a href={`/api/notices/${v.notice.id}/pdf`} className="text-brand underline">COBRA election packet (PDF)</a>
              <span className="text-ink-muted"> · sent {date(v.me.noticeSentOn)}</span>
            </li>
          )}
        </ul>
        <ActionForm action={paperCopyAction.bind(null, slug)} className="mt-4">
          <SubmitButton variant="secondary">Mail me a free paper copy</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Changes">
        <p className="text-sm text-ink-soft">
          To change your address, add a newborn or adopted child, report a disability determination, divorce or a second qualifying event, or drop coverage, contact us. You have 60 days to report most events.
        </p>
      </Card>
    </div>
  );
}

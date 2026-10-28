import { notFound } from "next/navigation";
import { E_DELIVERY_DISCLOSURE, getConsentContext } from "@cod/core";
import { Logo } from "@/components/site";
import { Alert, Card } from "@/components/ui";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Electronic delivery consent" };

export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getConsentContext(token);
  if (!ctx) notFound();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4"><Logo /></div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Get your COBRA notices by email</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Hi {ctx.employee.firstName}. {ctx.company.name} uses COBRA on Demand to administer COBRA continuation coverage. If your health coverage ever ends, we can send your notices by email instead of paper mail, but only with your permission.
          </p>
        </div>
        {ctx.consent && !ctx.consent.withdrawnAt && <Alert tone="ok">You consented to electronic delivery at {ctx.consent.email}. You can update or withdraw below.</Alert>}
        <Card title="Before you decide">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
            {E_DELIVERY_DISCLOSURE.map((d) => <li key={d}>{d}</li>)}
          </ul>
          <p className="mt-3 text-sm text-ink-soft">Your COBRA rights are the same whether or not you consent. Without consent, notices are mailed to your home.</p>
        </Card>
        <ConsentForm token={token} email={ctx.consent?.email ?? ctx.employee.email ?? ""} hasConsent={Boolean(ctx.consent)} />
      </main>
    </div>
  );
}

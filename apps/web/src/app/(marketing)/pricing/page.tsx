import { PricingCalculator } from "@/components/pricing-calculator";
import { ButtonLink } from "@/components/ui";

export const metadata = { title: "Pricing" };

const upgrades = [
  { name: "Multi-state", body: "State continuation rules beyond California as they're added." },
  { name: "Advanced reporting", body: "Saved ranges, scheduled email reports, carrier reconciliation and a DOL audit packet." },
  { name: "Volume pricing", body: "A lower rate per packet and per enrollee for larger groups." },
];

export default function Pricing() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-ink">Simple, on-demand pricing</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">You pay only for COBRA activity. No setup fee, no monthly minimum, nothing until the first packet is sent.</p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-line p-6">
          <p className="text-sm font-medium text-ink-muted">Per COBRA packet sent</p>
          <p className="mt-2 text-4xl font-semibold text-ink">$12</p>
          <p className="mt-2 text-sm text-ink-soft">Charged when the election packet is delivered: notices, election form, rate sheet, state notices and proof of delivery.</p>
        </div>
        <div className="rounded-lg border border-line p-6">
          <p className="text-sm font-medium text-ink-muted">Per active enrollee, per month</p>
          <p className="mt-2 text-4xl font-semibold text-ink">$12</p>
          <p className="mt-2 text-sm text-ink-soft">Premium billing and collection, autopay, grace and shortfall handling, remittance and termination notices.</p>
        </div>
      </div>

      <ul className="mt-6 space-y-2 text-sm text-ink-soft">
        <li>• Enrollees pay 100% of the plan cost. No admin fee or card fee is added for them.</li>
        <li>• Optional company-paid COBRA: set the months and percent per event or as a default.</li>
        <li>• Paper is the exception: a manual administration fee applies per participant without e-delivery consent.</li>
      </ul>

      <h2 className="mt-14 text-xl font-semibold text-ink">Estimate</h2>
      <div className="mt-4">
        <PricingCalculator />
      </div>

      <h2 className="mt-14 text-xl font-semibold text-ink">Upgrades</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {upgrades.map((u) => (
          <div key={u.name} className="rounded-lg border border-line p-5">
            <h3 className="font-semibold text-ink">{u.name}</h3>
            <p className="mt-2 text-sm text-ink-soft">{u.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-12">
        <ButtonLink href="/get-started">Get started</ButtonLink>
      </div>
    </div>
  );
}

import { PricingCalculator } from "@/components/pricing-calculator";
import { ButtonLink } from "@/components/ui";

const steps = [
  { title: "Connect payroll or benefits", body: "Sign in to Gusto, ADP, Paychex, Employee Navigator and more, or upload a census file. Plans, rates, employees and elections import automatically." },
  { title: "Terminations trigger packets", body: "When a termination shows up in your payroll sync, we build the election packet, deliver it on time and keep the proof. You confirm with one tap, or it goes out automatically." },
  { title: "Enrollees elect and pay online", body: "Former employees verify their identity, choose plans for each family member, sign, and set up autopay from their phone." },
  { title: "We collect and remit", body: "Premiums at 100% of plan cost, grace periods, shortfall notices and terminations are handled for you, with a monthly remittance report." },
];

const faqs = [
  { q: "What does it cost?", a: "One flat rate per COBRA packet sent, plus the same flat rate per active COBRA enrollee per month. Launch pricing is $12 for each. No setup fee, no minimums, and nothing is charged until the first packet goes out." },
  { q: "Do enrollees pay an admin fee?", a: "No. The law allows 102% of plan cost, but we bill enrollees exactly 100%. Our fees go to the employer (or its broker) only." },
  { q: "Who is eligible?", a: "Employers subject to federal COBRA: 20 or more employees on at least half of the business days in the prior calendar year. Smaller California groups are covered by Cal-COBRA, which the carrier runs." },
  { q: "Is everything electronic?", a: "Yes, by default. Employees consent to electronic delivery in advance. Anyone who hasn't consented still gets their packet on time by first-class mail, automatically. A manual administration fee applies to those cases and is billed to the employer, never the employee." },
  { q: "What about California notices?", a: "Every California packet includes the Labor Code 2800.2 continuation notice, the HIPP notice, Covered California information and, for insured plans, the Cal-COBRA 36-month extension notice." },
  { q: "Can my broker pay the fees?", a: "Yes. Choose who pays during setup; a broker gets a secure link to add a card or bank account and can cover many clients on one invoice." },
];

export default function Landing() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-light/60 to-white">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <p className="text-sm font-medium text-brand">COBRA administration, on demand</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-ink sm:text-5xl">Pay only when someone leaves. We handle every COBRA step after that.</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">
            One flat rate per COBRA packet sent, plus the same rate per active enrollee each month. Notices, elections, premium collection and terminations run automatically from your payroll data.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/get-started">Get started</ButtonLink>
            <ButtonLink href="/pricing" variant="secondary">
              See pricing
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-ink-muted">Typical setup takes under 15 minutes with a connected payroll platform.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold text-ink">How it works</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-lg border border-line p-5">
              <span className="text-sm font-semibold text-brand">Step {i + 1}</span>
              <h3 className="mt-2 font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold text-ink">Estimate your cost</h2>
          <p className="mt-2 text-ink-soft">$12 per packet sent and $12 per active enrollee per month. Volume pricing is available for larger groups.</p>
          <div className="mt-6">
            <PricingCalculator />
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-4 py-16">
        <h2 className="text-2xl font-semibold text-ink">Frequently asked questions</h2>
        <dl className="mt-6 divide-y divide-line">
          {faqs.map((f) => (
            <div key={f.q} className="py-5">
              <dt className="font-medium text-ink">{f.q}</dt>
              <dd className="mt-2 text-sm leading-6 text-ink-soft">{f.a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10">
          <ButtonLink href="/get-started">Get started</ButtonLink>
        </div>
      </section>
    </>
  );
}

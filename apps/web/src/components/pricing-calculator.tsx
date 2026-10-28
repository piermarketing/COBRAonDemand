"use client";

import { useMemo, useState } from "react";
import { estimateMonthlyCost, LAUNCH_PRICE_TIERS } from "@cod/billing";
import { formatCents } from "@cod/rules";
import { Field, Input } from "./ui";

/** MKT-2: employee count and expected terminations → monthly estimate. */
export function PricingCalculator() {
  const [employees, setEmployees] = useState(60);
  const [terms, setTerms] = useState(12);
  const estimate = useMemo(
    () => estimateMonthlyCost({ benefitEnrolledEmployees: employees, expectedTerminationsPerYear: terms }, LAUNCH_PRICE_TIERS),
    [employees, terms],
  );
  const tooSmall = employees > 0 && employees < 20;

  return (
    <div className="grid gap-6 rounded-lg border border-line bg-white p-6 md:grid-cols-2">
      <div className="space-y-4">
        <Field label="Employees in the prior calendar year" hint="Federal COBRA applies at 20 or more.">
          <Input type="number" min={0} value={employees} onChange={(e) => setEmployees(Math.max(0, Number(e.target.value)))} />
        </Field>
        <Field label="Terminations of covered employees per year">
          <Input type="number" min={0} value={terms} onChange={(e) => setTerms(Math.max(0, Number(e.target.value)))} />
        </Field>
      </div>
      <div className="rounded-md bg-paper p-5">
        {tooSmall ? (
          <p className="text-sm text-ink-soft">
            Groups under 20 employees fall under state continuation law. In California, your carrier runs Cal-COBRA for you at no cost to the employer.
          </p>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Estimated monthly cost</p>
            <p className="mt-1 text-3xl font-semibold text-ink tabular-nums">{formatCents(estimate.monthlyCost)}</p>
            <p className="mt-1 text-sm text-ink-muted">{formatCents(estimate.annualCost)} per year</p>
            <dl className="mt-4 space-y-1 text-sm text-ink-soft">
              <div className="flex justify-between">
                <dt>Packets per month</dt>
                <dd className="tabular-nums">{estimate.packetsPerMonth}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Active enrollees (steady state)</dt>
                <dd className="tabular-nums">{estimate.steadyStateEnrollees}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Rate per packet and per enrollee month</dt>
                <dd className="tabular-nums">{formatCents(estimate.unitPrice)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-muted">
              Assumes {Math.round(estimate.assumptions.electionRate * 100)}% of terminated employees elect COBRA and stay {estimate.assumptions.averageMonthsEnrolled} months.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

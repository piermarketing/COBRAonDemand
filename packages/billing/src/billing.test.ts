import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  employerMonthlyCharges,
  estimateMonthlyCost,
  EXAMPLE_VOLUME_TIERS,
  LAUNCH_PRICE_TIERS,
  premiumInvoicedPosting,
  premiumPaymentPosting,
  remittancePosting,
  trialBalance,
  unitPriceFor,
  validateTiers,
} from "./index";

describe("pricing", () => {
  it("charges the launch $12 rate for packets and enrollee months", () => {
    const lines = employerMonthlyCharges({ packetsSent: 2, activeEnrolleeMonths: 5, manualAdminParticipants: 1 }, LAUNCH_PRICE_TIERS, 2500);
    expect(lines.map((l) => [l.type, l.amount])).toEqual([
      ["packet", 2400],
      ["enrollee_month", 6000],
      ["manual_admin", 2500],
    ]);
  });

  it("applies the reached volume tier to every unit", () => {
    expect(unitPriceFor(EXAMPLE_VOLUME_TIERS, 20)).toBe(1200);
    expect(unitPriceFor(EXAMPLE_VOLUME_TIERS, 21)).toBe(1000);
    expect(unitPriceFor(EXAMPLE_VOLUME_TIERS, 400)).toBe(800);
  });

  it("validates tier tables", () => {
    expect(validateTiers(EXAMPLE_VOLUME_TIERS)).toEqual([]);
    expect(validateTiers([{ min: 0, max: 10, unitPrice: 1200, plan: "standard" }])).toContain("The last tier must be open-ended.");
    expect(
      validateTiers([
        { min: 0, max: 10, unitPrice: 1200, plan: "volume" },
        { min: 12, max: null, unitPrice: 1000, plan: "volume" },
      ]),
    ).toContain("Tiers 1 and 2 must be contiguous.");
  });

  it("estimates a monthly cost from headcount and terminations", () => {
    const e = estimateMonthlyCost({ benefitEnrolledEmployees: 60, expectedTerminationsPerYear: 12 });
    expect(e.packetsPerMonth).toBe(1);
    expect(e.steadyStateEnrollees).toBe(1.6);
    expect(e.monthlyCost).toBe(3120);
  });
});

describe("ledger", () => {
  it("rejects unbalanced postings", () => {
    expect(() =>
      assertBalanced({ refType: "x", refId: "1", memo: "", lines: [{ account: "cash_trust", debit: 100, credit: 0 }, { account: "premiums_receivable", debit: 0, credit: 90 }] }),
    ).toThrow(/Unbalanced/);
  });

  it("nets to zero after invoice, payment and remittance", () => {
    const postings = [premiumInvoicedPosting("inv1", 40_000, 10_000), premiumPaymentPosting("pay1", 40_000), remittancePosting("rem1", 40_000)];
    const tb = trialBalance(postings);
    expect(tb.premiums_receivable).toBe(0);
    expect(tb.cash_trust).toBe(0);
    expect(tb.employer_subsidy_receivable).toBe(10_000);
    expect(tb.premiums_payable).toBe(-10_000);
    expect(Object.values(tb).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

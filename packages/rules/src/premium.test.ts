import { describe, expect, it } from "vitest";
import { deriveTier } from "./tiers";
import { assertTransition, canTransition, isActiveEnrollee, isTerminal } from "./lifecycle";
import {
  cobraMonthlyPremium,
  evaluateInvoice,
  initialPremiumAmount,
  isInsignificantShortfall,
  legalMaxPremium,
  premiumPeriods,
  splitSubsidy,
} from "./premium";

describe("premiums", () => {
  it("charges 100% of total plan cost and stays under the legal cap", () => {
    expect(cobraMonthlyPremium(85_000)).toBe(85_000);
    expect(legalMaxPremium(85_000)).toBe(86_700);
    expect(legalMaxPremium(85_000, { disability: true })).toBe(127_500);
    expect(legalMaxPremium(85_000, { regime: "state_extension", state: "CA" })).toBe(93_500);
  });

  it("rejects fractional cents", () => {
    expect(() => cobraMonthlyPremium(12.5)).toThrow();
  });

  it("builds monthly periods and prorates partial months", () => {
    const periods = premiumPeriods("2026-11-15", "2027-01-20", "2028-05-14", 30_000);
    expect(periods.map((p) => p.dueDate)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(periods[0]).toMatchObject({ periodStart: "2026-11-15", periodEnd: "2026-11-30", prorated: true, amount: 16_000 });
    expect(periods[1]).toMatchObject({ amount: 30_000, prorated: false, graceEnd: "2026-12-31" });
  });

  it("stops at the maximum coverage end", () => {
    const periods = premiumPeriods("2026-11-01", "2027-06-01", "2027-01-15", 31_000);
    expect(periods).toHaveLength(3);
    expect(periods[2]).toMatchObject({ periodEnd: "2027-01-15", amount: 15_000 });
  });

  it("bills every month back to the loss of coverage in the first payment", () => {
    expect(initialPremiumAmount("2026-11-01", "2026-12-20", "2028-04-30", 50_000)).toBe(100_000);
  });

  it("treats a small shortfall as paid but a large one as unpaid", () => {
    expect(isInsignificantShortfall(50_000, 45_000)).toBe(true); // $50 short, under lesser of $50 / $50
    expect(isInsignificantShortfall(50_000, 44_999)).toBe(false);
    expect(isInsignificantShortfall(20_000, 18_000)).toBe(true); // 10% of $200 = $20
    expect(isInsignificantShortfall(20_000, 17_999)).toBe(false);
    expect(isInsignificantShortfall(20_000, 20_000)).toBe(false);
  });

  describe("invoice evaluation", () => {
    const invoice = { amountDue: 50_000, dueDate: "2027-02-01", finalPaymentDate: "2027-03-03" };

    it("is due before the due date and in grace after it", () => {
      expect(evaluateInvoice({ ...invoice, payments: [], today: "2027-01-25" }).status).toBe("due");
      expect(evaluateInvoice({ ...invoice, payments: [], today: "2027-02-10" }).status).toBe("in_grace");
    });

    it("lapses after the grace period", () => {
      expect(evaluateInvoice({ ...invoice, payments: [], today: "2027-03-04" }).status).toBe("lapsed");
    });

    it("ignores payments after the final payment date", () => {
      const r = evaluateInvoice({ ...invoice, payments: [{ amount: 50_000, paidOn: "2027-03-05" }], today: "2027-03-06" });
      expect(r.status).toBe("lapsed");
    });

    it("opens a 30-day cure window for an insignificant shortfall", () => {
      const r = evaluateInvoice({ ...invoice, payments: [{ amount: 46_000, paidOn: "2027-02-10" }], today: "2027-02-20" });
      expect(r.status).toBe("shortfall_cure");
      expect(r.cureBy).toBe("2027-03-12");
    });

    it("is paid once the shortfall is cured", () => {
      const r = evaluateInvoice({
        ...invoice,
        payments: [
          { amount: 46_000, paidOn: "2027-02-10" },
          { amount: 4_000, paidOn: "2027-03-10" },
        ],
        today: "2027-03-20",
      });
      expect(r.status).toBe("paid");
    });
  });

  it("splits company-paid months", () => {
    expect(splitSubsidy(60_000, 0, { months: 3, percent: 100 })).toEqual({ employer: 60_000, enrollee: 0 });
    expect(splitSubsidy(60_000, 2, { months: 3, percent: 50 })).toEqual({ employer: 30_000, enrollee: 30_000 });
    expect(splitSubsidy(60_000, 3, { months: 3, percent: 50 })).toEqual({ employer: 0, enrollee: 60_000 });
    expect(splitSubsidy(60_000, 0, null)).toEqual({ employer: 0, enrollee: 60_000 });
  });
});

describe("beneficiary lifecycle", () => {
  it("allows the normal path", () => {
    expect(() => {
      assertTransition("pending_notice", "notice_sent");
      assertTransition("notice_sent", "elected");
      assertTransition("elected", "active");
      assertTransition("active", "grace");
      assertTransition("grace", "active");
      assertTransition("active", "terminated");
    }).not.toThrow();
  });

  it("lets a waiver be revoked", () => {
    expect(canTransition("waived", "elected")).toBe(true);
  });

  it("blocks skipping states and leaving terminal ones", () => {
    expect(canTransition("pending_notice", "active")).toBe(false);
    expect(canTransition("terminated", "active")).toBe(false);
    expect(() => assertTransition("expired", "elected")).toThrow();
    expect(isTerminal("cancelled")).toBe(true);
  });

  it("counts elected, active and grace as active enrollees", () => {
    expect(isActiveEnrollee("active")).toBe(true);
    expect(isActiveEnrollee("grace")).toBe(true);
    expect(isActiveEnrollee("notice_sent")).toBe(false);
  });
});

describe("tier derivation", () => {
  it("follows who actually elects", () => {
    expect(deriveTier(["employee", "spouse", "child"])).toBe("family");
    expect(deriveTier(["employee", "spouse"])).toBe("employee_spouse");
    expect(deriveTier(["spouse", "child", "child"])).toBe("employee_children");
    expect(deriveTier(["child"])).toBe("employee");
    expect(deriveTier(["child", "child"])).toBe("employee_children");
    expect(deriveTier([])).toBeNull();
  });
});

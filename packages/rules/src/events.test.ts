import { describe, expect, it } from "vitest";
import {
  baseCoverageMonths,
  beneficiaryReportDeadline,
  cobraStartDate,
  disabilityExtension,
  eligibleRelationships,
  isEmployerReported,
  lastDayOfCoverage,
  maxCoverageEnd,
  secondEventExtension,
} from "./events";

describe("qualifying events", () => {
  it("gives 18 months for termination and reduced hours, 36 for the rest", () => {
    expect(baseCoverageMonths("termination")).toBe(18);
    expect(baseCoverageMonths("reduction_in_hours")).toBe(18);
    for (const t of ["death", "divorce", "legal_separation", "medicare_entitlement", "dependent_loss_of_status"] as const) {
      expect(baseCoverageMonths(t)).toBe(36);
    }
  });

  it("names who can elect for each event", () => {
    expect(eligibleRelationships("termination")).toEqual(["employee", "spouse", "child"]);
    expect(eligibleRelationships("divorce")).toEqual(["spouse", "child"]);
    expect(eligibleRelationships("dependent_loss_of_status")).toEqual(["child"]);
  });

  it("knows who reports each event", () => {
    expect(isEmployerReported("termination")).toBe(true);
    expect(isEmployerReported("death")).toBe(true);
    expect(isEmployerReported("divorce")).toBe(false);
    expect(isEmployerReported("dependent_loss_of_status")).toBe(false);
  });

  it("computes the last covered day from the plan rule", () => {
    expect(lastDayOfCoverage("2026-10-15", "end_of_month")).toBe("2026-10-31");
    expect(lastDayOfCoverage("2028-02-03", "end_of_month")).toBe("2028-02-29");
    expect(lastDayOfCoverage("2026-10-15", "termination_date")).toBe("2026-10-15");
    expect(cobraStartDate("2026-10-31")).toBe("2026-11-01");
  });

  it("computes an 18-month max end date", () => {
    const r = maxCoverageEnd({ type: "termination", relationship: "employee", cobraStart: "2026-11-01", eventDate: "2026-10-15" });
    expect(r.months).toBe(18);
    expect(r.endDate).toBe("2028-04-30");
  });

  it("computes a 36-month max end date for divorce", () => {
    const r = maxCoverageEnd({ type: "divorce", relationship: "spouse", cobraStart: "2026-07-01", eventDate: "2026-06-20" });
    expect(r.endDate).toBe("2029-06-30");
  });

  it("applies the Medicare 36-month rule for dependents", () => {
    // Employee entitled to Medicare 2026-03-01, terminated 2026-10-15 (within 18 months).
    const spouse = maxCoverageEnd({
      type: "termination",
      relationship: "spouse",
      cobraStart: "2026-11-01",
      eventDate: "2026-10-15",
      employeeMedicareEntitlementDate: "2026-03-01",
    });
    expect(spouse.months).toBe(36);
    expect(spouse.endDate).toBe("2029-02-28");

    const employee = maxCoverageEnd({
      type: "termination",
      relationship: "employee",
      cobraStart: "2026-11-01",
      eventDate: "2026-10-15",
      employeeMedicareEntitlementDate: "2026-03-01",
    });
    expect(employee.months).toBe(18);
  });

  it("ignores Medicare entitlement more than 18 months before the event", () => {
    const r = maxCoverageEnd({
      type: "termination",
      relationship: "spouse",
      cobraStart: "2026-11-01",
      eventDate: "2026-10-15",
      employeeMedicareEntitlementDate: "2024-01-01",
    });
    expect(r.months).toBe(18);
  });

  describe("disability extension", () => {
    const base = { cobraStart: "2026-11-01", originalMaxEnd: "2028-04-30" };

    it("extends to 29 months when every condition is met", () => {
      const r = disabilityExtension({ ...base, disabilityOnsetDate: "2026-12-15", ssaDeterminationDate: "2027-06-01", notifiedOn: "2027-07-01" });
      expect(r.eligible).toBe(true);
      expect(r.newMaxEnd).toBe("2029-03-31");
    });

    it("refuses when the disability began after day 60", () => {
      const r = disabilityExtension({ ...base, disabilityOnsetDate: "2027-01-05", ssaDeterminationDate: "2027-06-01", notifiedOn: "2027-06-10" });
      expect(r.eligible).toBe(false);
    });

    it("refuses late notice", () => {
      const r = disabilityExtension({ ...base, disabilityOnsetDate: "2026-11-15", ssaDeterminationDate: "2027-01-01", notifiedOn: "2027-03-15" });
      expect(r.eligible).toBe(false);
    });
  });

  describe("second qualifying event", () => {
    const base = { firstEventType: "termination" as const, cobraStart: "2026-11-01", currentMaxEnd: "2028-04-30" };

    it("extends a spouse to 36 months after a divorce", () => {
      const r = secondEventExtension({ ...base, secondEventType: "divorce", relationship: "spouse", secondEventDate: "2027-05-01", notifiedOn: "2027-06-01" });
      expect(r.eligible).toBe(true);
      expect(r.newMaxEnd).toBe("2029-10-31");
    });

    it("never extends the employee", () => {
      const r = secondEventExtension({ ...base, secondEventType: "divorce", relationship: "employee", secondEventDate: "2027-05-01", notifiedOn: "2027-06-01" });
      expect(r.eligible).toBe(false);
    });

    it("requires a 36-month second event", () => {
      const r = secondEventExtension({ ...base, secondEventType: "reduction_in_hours", relationship: "spouse", secondEventDate: "2027-05-01", notifiedOn: "2027-05-02" });
      expect(r.eligible).toBe(false);
    });
  });

  it("gives beneficiaries 60 days to report", () => {
    expect(beneficiaryReportDeadline("2026-06-20", "2026-07-01")).toBe("2026-08-30");
  });
});

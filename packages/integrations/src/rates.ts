import type { CanonicalEmployee } from "./canonical";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

const PERIODS_PER_YEAR: Record<PayFrequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/**
 * INT-4: when only payroll is connected, the monthly premium per tier is the
 * employee deduction plus the employer contribution, converted from pay
 * period to monthly. The employer confirms the result once.
 */
export function deriveMonthlyPremium(employeeDeductionPerPeriod: number, employerContributionPerPeriod: number, frequency: PayFrequency): number {
  const perPeriod = employeeDeductionPerPeriod + employerContributionPerPeriod;
  return Math.round((perPeriod * PERIODS_PER_YEAR[frequency]) / 12);
}

/** PLN-14: a deduction-only rate can't be used; block go-live until the total rate is supplied. */
export function isTotalRateKnown(rate: { totalMonthly?: number; employeeDeductionOnly?: boolean }): boolean {
  return rate.totalMonthly !== undefined && !rate.employeeDeductionOnly;
}

export interface MatchKeyInput {
  ssnHash?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

/** INT-5: match people across sources by hashed SSN, then name + DOB. */
export function matchKey(p: MatchKeyInput): string {
  if (p.ssnHash) return `ssn:${p.ssnHash}`;
  return `nd:${p.firstName.trim().toLowerCase()}|${p.lastName.trim().toLowerCase()}|${p.dateOfBirth}`;
}

export interface MergeConflict {
  sourceId: string;
  field: string;
  payroll: unknown;
  benAdmin: unknown;
}

/** Payroll wins for employment data; ben-admin wins for plans and elections. Disagreements are listed for review. */
export function mergeEmployees(
  payroll: CanonicalEmployee[],
  benAdmin: CanonicalEmployee[],
): { merged: CanonicalEmployee[]; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = [];
  const keyOf = (e: CanonicalEmployee) => matchKey({ firstName: e.firstName, lastName: e.lastName, dateOfBirth: e.dateOfBirth });
  const benByKey = new Map(benAdmin.map((e) => [keyOf(e), e]));
  const merged = payroll.map((p) => {
    const b = benByKey.get(keyOf(p));
    if (!b) return p;
    benByKey.delete(keyOf(p));
    for (const field of ["terminationDate", "hireDate", "status"] as const) {
      if (b[field] !== undefined && p[field] !== b[field]) conflicts.push({ sourceId: p.sourceId, field, payroll: p[field], benAdmin: b[field] });
    }
    return { ...b, ...p, personalEmail: p.personalEmail ?? b.personalEmail, phone: p.phone ?? b.phone };
  });
  return { merged: [...merged, ...benByKey.values()], conflicts };
}

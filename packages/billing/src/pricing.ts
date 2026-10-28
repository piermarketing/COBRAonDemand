import type { Cents } from "@cod/rules";

/**
 * Employer pricing: one flat rate per COBRA packet sent plus the same rate
 * monthly per active COBRA enrollee (BIL-1, BIL-2). Tiers are admin-editable
 * data, never code; launch pricing is a single $12 tier.
 */

export interface PriceTier {
  /** Inclusive lower bound of monthly billable units (packets + enrollee months). */
  min: number;
  /** Inclusive upper bound; null for open-ended. */
  max: number | null;
  unitPrice: Cents;
  plan: "standard" | "volume";
}

export const LAUNCH_PRICE_TIERS: PriceTier[] = [{ min: 0, max: null, unitPrice: 1200, plan: "standard" }];

/** Placeholder declining scale for when volume pricing turns on (prices still to be decided). */
export const EXAMPLE_VOLUME_TIERS: PriceTier[] = [
  { min: 0, max: 20, unitPrice: 1200, plan: "volume" },
  { min: 21, max: 50, unitPrice: 1000, plan: "volume" },
  { min: 51, max: null, unitPrice: 800, plan: "volume" },
];

/** Manual administration fee per opted-out (paper) participant per month (ELE-6, BIL-9). Amount to be set. */
export const DEFAULT_MANUAL_ADMIN_FEE: Cents = 2500;

export function validateTiers(tiers: PriceTier[]): string[] {
  const errors: string[] = [];
  if (tiers.length === 0) errors.push("At least one price tier is required.");
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  sorted.forEach((t, i) => {
    if (t.unitPrice < 0 || !Number.isInteger(t.unitPrice)) errors.push(`Tier ${i + 1}: unit price must be whole cents.`);
    if (t.max !== null && t.max < t.min) errors.push(`Tier ${i + 1}: max is below min.`);
    const next = sorted[i + 1];
    if (next) {
      if (t.max === null) errors.push(`Tier ${i + 1}: only the last tier can be open-ended.`);
      else if (next.min !== t.max + 1) errors.push(`Tiers ${i + 1} and ${i + 2} must be contiguous.`);
    } else if (t.max !== null) {
      errors.push("The last tier must be open-ended.");
    }
  });
  if (sorted[0] && sorted[0].min > 1) errors.push("The first tier must start at 0 or 1.");
  return errors;
}

/** Unit price for a month's volume. The tier reached applies to every unit, not marginally. */
export function unitPriceFor(tiers: PriceTier[], units: number): Cents {
  const tier = tiers.find((t) => units >= t.min && (t.max === null || units <= t.max)) ?? tiers.at(-1);
  if (!tier) throw new Error("No price tiers configured");
  return tier.unitPrice;
}

export interface MonthlyUsage {
  packetsSent: number;
  activeEnrolleeMonths: number;
  manualAdminParticipants: number;
}

export interface ChargeLine {
  type: "packet" | "enrollee_month" | "manual_admin";
  description: string;
  quantity: number;
  unitPrice: Cents;
  amount: Cents;
}

export function employerMonthlyCharges(usage: MonthlyUsage, tiers: PriceTier[], manualAdminFee: Cents = DEFAULT_MANUAL_ADMIN_FEE): ChargeLine[] {
  const unit = unitPriceFor(tiers, usage.packetsSent + usage.activeEnrolleeMonths);
  const lines: ChargeLine[] = [];
  if (usage.packetsSent > 0) {
    lines.push({ type: "packet", description: "COBRA packets sent", quantity: usage.packetsSent, unitPrice: unit, amount: unit * usage.packetsSent });
  }
  if (usage.activeEnrolleeMonths > 0) {
    lines.push({
      type: "enrollee_month",
      description: "Active COBRA enrollees",
      quantity: usage.activeEnrolleeMonths,
      unitPrice: unit,
      amount: unit * usage.activeEnrolleeMonths,
    });
  }
  if (usage.manualAdminParticipants > 0) {
    lines.push({
      type: "manual_admin",
      description: "Manual (paper) administration",
      quantity: usage.manualAdminParticipants,
      unitPrice: manualAdminFee,
      amount: manualAdminFee * usage.manualAdminParticipants,
    });
  }
  return lines;
}

export interface EstimateInput {
  benefitEnrolledEmployees: number;
  expectedTerminationsPerYear: number;
  /** Share of terminated employees who elect COBRA. */
  electionRate?: number;
  /** Average months an enrollee stays on COBRA. */
  averageMonthsEnrolled?: number;
}

export interface Estimate {
  packetsPerMonth: number;
  steadyStateEnrollees: number;
  monthlyCost: Cents;
  annualCost: Cents;
  unitPrice: Cents;
  assumptions: { electionRate: number; averageMonthsEnrolled: number };
}

/** Pricing calculator for the marketing site (MKT-2). */
export function estimateMonthlyCost(input: EstimateInput, tiers: PriceTier[] = LAUNCH_PRICE_TIERS): Estimate {
  const electionRate = input.electionRate ?? 0.2;
  const averageMonthsEnrolled = input.averageMonthsEnrolled ?? 8;
  const terminations = Math.max(0, Math.min(input.expectedTerminationsPerYear, input.benefitEnrolledEmployees * 3));
  const packetsPerMonth = terminations / 12;
  const steadyStateEnrollees = packetsPerMonth * electionRate * averageMonthsEnrolled;
  const unitPrice = unitPriceFor(tiers, Math.round(packetsPerMonth + steadyStateEnrollees));
  const monthlyCost = Math.round((packetsPerMonth + steadyStateEnrollees) * unitPrice);
  return {
    packetsPerMonth: Math.round(packetsPerMonth * 10) / 10,
    steadyStateEnrollees: Math.round(steadyStateEnrollees * 10) / 10,
    monthlyCost,
    annualCost: monthlyCost * 12,
    unitPrice,
    assumptions: { electionRate, averageMonthsEnrolled },
  };
}

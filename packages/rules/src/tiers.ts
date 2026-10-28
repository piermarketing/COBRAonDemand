import type { Relationship } from "./events";

export const TIERS = ["employee", "employee_spouse", "employee_children", "family"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  employee: "Employee only",
  employee_spouse: "Employee + spouse",
  employee_children: "Employee + child(ren)",
  family: "Family",
};

/**
 * Coverage tier for the people who actually elect a plan. Each beneficiary
 * elects independently, so a family can drop to a lower tier (e.g. only the
 * spouse and a child elect → one adult with children). A lone child or lone
 * spouse is single coverage.
 */
export function deriveTier(electing: Relationship[]): Tier | null {
  if (electing.length === 0) return null;
  const adults = electing.filter((r) => r === "employee" || r === "spouse").length;
  const children = electing.length - adults;
  if (adults >= 2) return children > 0 ? "family" : "employee_spouse";
  if (adults === 1) return children > 0 ? "employee_children" : "employee";
  return children === 1 ? "employee" : "employee_children";
}

/** Tiers ordered from smallest to largest, for "drop to a lower tier" checks. */
export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

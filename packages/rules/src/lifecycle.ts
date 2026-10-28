/**
 * Qualified-beneficiary state machine. Each beneficiary (not each household)
 * moves through these states; every transition is written to the audit log
 * by the caller.
 */

export const QB_STATUSES = [
  "pending_notice",
  "notice_sent",
  "waived",
  "elected",
  "active",
  "grace",
  "expired",
  "terminated",
  "cancelled",
  "ineligible",
] as const;
export type QbStatus = (typeof QB_STATUSES)[number];

export const QB_STATUS_LABELS: Record<QbStatus, string> = {
  pending_notice: "Notice pending",
  notice_sent: "Pending election",
  waived: "Waived",
  elected: "Elected, awaiting first payment",
  active: "Active",
  grace: "Grace period",
  expired: "Rights expired",
  terminated: "Ended",
  cancelled: "Cancelled",
  ineligible: "Not eligible (unavailability notice sent)",
};

export const TERMINATION_REASONS = [
  "max_coverage_reached",
  "nonpayment",
  "initial_premium_not_paid",
  "other_group_coverage",
  "medicare_entitlement",
  "employer_dropped_plans",
  "voluntary",
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

const TRANSITIONS: Record<QbStatus, readonly QbStatus[]> = {
  // Cancelled covers reversals before mailing (rehire, deleted termination — TRG-9).
  pending_notice: ["notice_sent", "cancelled", "ineligible"],
  notice_sent: ["elected", "waived", "expired"],
  // A waiver can be revoked any time before the election window closes.
  waived: ["elected", "expired"],
  elected: ["active", "terminated"],
  active: ["grace", "terminated"],
  grace: ["active", "terminated"],
  expired: [],
  terminated: [],
  cancelled: [],
  ineligible: [],
};

export function canTransition(from: QbStatus, to: QbStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: QbStatus, to: QbStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid beneficiary transition: ${from} → ${to}`);
  }
}

export function isTerminal(status: QbStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Counted as an "active COBRA enrollee" for dashboards and the monthly per-enrollee fee. */
export function isActiveEnrollee(status: QbStatus): boolean {
  return status === "active" || status === "grace" || status === "elected";
}

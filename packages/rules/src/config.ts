/**
 * COBRA ruleset as data.
 *
 * The deadline engine reads every number from here so counsel can review one
 * file, and so other states can be added as configuration rather than code
 * (see "Adding other states" in the packet requirements). Values reflect
 * federal COBRA (ERISA / IRC 4980B, 29 CFR 2590.606) and California
 * (H&S Code 1366.20+, Ins. Code 10128.50+, AB 1401, Labor Code 2800.2 / 2807).
 *
 * Requirements reference only — have ERISA counsel confirm before launch.
 */

export const RULESET_VERSION = "2026.10-draft";

export interface FederalRules {
  /** Employers with at least this many employees on 50%+ of business days in the prior year. */
  minEmployees: number;
  generalNoticeDays: number;
  employerNoticeDays: number;
  electionNoticeDays: number;
  /** Combined 30 + 14 when the employer is also the plan administrator. */
  electionNoticeDaysEmployerIsAdministrator: number;
  beneficiaryNoticeDays: number;
  electionWindowDays: number;
  initialPremiumDays: number;
  graceDays: number;
  cureDays: number;
  shortfall: { absolute: number; percent: number };
  /** Legal maximum premium as a multiple of plan cost. */
  maxPremiumMultiplier: number;
  maxPremiumMultiplierDisability: number;
  durationsMonths: { standard: number; disability: number; extended: number };
  /** An SSA disability determination must fall within this many days of COBRA starting. */
  disabilityDeterminationWindowDays: number;
  recordRetentionYears: number;
}

export interface StateRules {
  code: string;
  name: string;
  /** Employer size the state's own continuation law covers. */
  employerSize: { min: number; max: number };
  maxDurationMonths: number;
  maxPremiumMultiplier: number;
  maxPremiumMultiplierDisability: number;
  administeredBy: "carrier" | "employer";
  employerNoticeDays: number;
  electionWindowDays: number;
  initialPremiumDays: number;
  /** Extension of federal COBRA for larger employers' insured plans (CA AB 1401). */
  extension?: { totalMonths: number; noticeDaysBeforeFederalEnd: number; insuredOnly: boolean };
  /** State-only notices that ride along with every federal packet. */
  packetNotices: string[];
  regulator: string;
}

export const FEDERAL: FederalRules = {
  minEmployees: 20,
  generalNoticeDays: 90,
  employerNoticeDays: 30,
  electionNoticeDays: 14,
  electionNoticeDaysEmployerIsAdministrator: 44,
  beneficiaryNoticeDays: 60,
  electionWindowDays: 60,
  initialPremiumDays: 45,
  graceDays: 30,
  cureDays: 30,
  shortfall: { absolute: 50, percent: 0.1 },
  maxPremiumMultiplier: 1.02,
  maxPremiumMultiplierDisability: 1.5,
  durationsMonths: { standard: 18, disability: 29, extended: 36 },
  disabilityDeterminationWindowDays: 60,
  recordRetentionYears: 6,
};

export const STATES: Record<string, StateRules> = {
  CA: {
    code: "CA",
    name: "California",
    employerSize: { min: 2, max: 19 },
    maxDurationMonths: 36,
    maxPremiumMultiplier: 1.1,
    maxPremiumMultiplierDisability: 1.5,
    administeredBy: "carrier",
    employerNoticeDays: 30,
    electionWindowDays: 60,
    initialPremiumDays: 45,
    extension: { totalMonths: 36, noticeDaysBeforeFederalEnd: 180, insuredOnly: true },
    packetNotices: ["ca_continuation_2800_2", "ca_hipp_2807"],
    regulator: "DMHC (HMOs), CDI (insurers)",
  },
};

/**
 * Company policy, separate from what the law allows: COBRA on Demand bills
 * enrollees 100% of the total plan cost and never adds the 2% admin fee.
 */
export const COMPANY_POLICY = {
  enrolleePremiumMultiplier: 1.0,
  enrolleePremiumMultiplierDisability: 1.0,
  /** Ops is alerted when an unsent notice is this close to its deadline. */
  opsAlertDaysBeforeDeadline: 2,
  gracePeriodWarningDays: [15, 25],
  maxCoverageWarningDays: [60, 30],
  defaultAutoProceedDays: 3,
};

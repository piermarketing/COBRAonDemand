import { FEDERAL, STATES } from "./config";

export const PLAN_TYPES = [
  "medical",
  "dental",
  "vision",
  "prescription",
  "hra",
  "health_fsa",
  "eap",
  "life",
  "disability",
] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

const COBRA_ELIGIBLE: ReadonlySet<PlanType> = new Set([
  "medical",
  "dental",
  "vision",
  "prescription",
  "hra",
  "health_fsa",
  "eap",
]);

/** Life and disability insurance are not COBRA benefits (PLN-3, INT-6). */
export function isCobraEligiblePlanType(type: PlanType): boolean {
  return COBRA_ELIGIBLE.has(type);
}

export type Regime = "federal" | "state" | "none";

export interface RegimeInput {
  /** Employees on 50%+ of typical business days in the prior calendar year. */
  priorYearEmployeeCount: number;
  state: string;
  /** Insured plans are needed for state continuation laws; self-funded plans are not covered. */
  hasInsuredPlan: boolean;
}

export interface RegimeResult {
  regime: Regime;
  /** COBRA on Demand only administers federal COBRA groups (ONB-7). */
  supported: boolean;
  /** For 20+ CA employers: the carrier-run 36-month extension must be described in our notices. */
  stateExtensionApplies: boolean;
  reason: string;
}

export function determineRegime(input: RegimeInput): RegimeResult {
  const { priorYearEmployeeCount: count, state } = input;
  const stateRules = STATES[state];

  if (count >= FEDERAL.minEmployees) {
    return {
      regime: "federal",
      supported: true,
      stateExtensionApplies: Boolean(stateRules?.extension && (!stateRules.extension.insuredOnly || input.hasInsuredPlan)),
      reason: `${count} employees: federal COBRA applies.`,
    };
  }

  if (stateRules && count >= stateRules.employerSize.min && input.hasInsuredPlan) {
    return {
      regime: "state",
      supported: false,
      stateExtensionApplies: false,
      reason: `${count} employees: ${stateRules.name} continuation coverage applies and is administered by the ${stateRules.administeredBy}. COBRA on Demand serves federal COBRA groups (20+ employees) only.`,
    };
  }

  return {
    regime: "none",
    supported: false,
    stateExtensionApplies: false,
    reason: `${count} employees: neither federal COBRA nor a supported state continuation law applies. Check the plan documents.`,
  };
}

export interface AnnualRetestResult {
  stillFederal: boolean;
  /** Current enrollees keep federal COBRA until their periods end, whatever the retest says. */
  keepCurrentEnrollees: true;
  /** New terminations go to the carrier when the group falls under 20. */
  routeNewTerminationsToCarrier: boolean;
  notifyEmployer: boolean;
}

/** Each January every client is re-tested against the prior year's headcount (ONB-7). */
export function annualRetest(priorYearEmployeeCount: number): AnnualRetestResult {
  const stillFederal = priorYearEmployeeCount >= FEDERAL.minEmployees;
  return {
    stillFederal,
    keepCurrentEnrollees: true,
    routeNewTerminationsToCarrier: !stillFederal,
    notifyEmployer: !stillFederal,
  };
}

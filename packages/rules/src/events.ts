import { FEDERAL } from "./config";
import { addDays, addMonths, compareDates, daysBetween, laterOf, type IsoDate } from "./dates";

export const QUALIFYING_EVENT_TYPES = [
  "termination",
  "reduction_in_hours",
  "death",
  "divorce",
  "legal_separation",
  "medicare_entitlement",
  "dependent_loss_of_status",
] as const;
export type QualifyingEventType = (typeof QUALIFYING_EVENT_TYPES)[number];

export const RELATIONSHIPS = ["employee", "spouse", "child"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const EVENT_LABELS: Record<QualifyingEventType, string> = {
  termination: "Termination of employment",
  reduction_in_hours: "Reduction in hours",
  death: "Death of the employee",
  divorce: "Divorce",
  legal_separation: "Legal separation",
  medicare_entitlement: "Employee's Medicare entitlement",
  dependent_loss_of_status: "Child losing dependent status",
};

const EIGHTEEN_MONTH_EVENTS: ReadonlySet<QualifyingEventType> = new Set(["termination", "reduction_in_hours"]);

/** Events the employer must report; the rest are reported by the beneficiary within 60 days. */
const EMPLOYER_REPORTED: ReadonlySet<QualifyingEventType> = new Set([
  "termination",
  "reduction_in_hours",
  "death",
  "medicare_entitlement",
]);

export function isEmployerReported(type: QualifyingEventType): boolean {
  return EMPLOYER_REPORTED.has(type);
}

/** Who becomes a qualified beneficiary for each event (separate rights per person). */
export function eligibleRelationships(type: QualifyingEventType): Relationship[] {
  if (EIGHTEEN_MONTH_EVENTS.has(type)) return ["employee", "spouse", "child"];
  if (type === "dependent_loss_of_status") return ["child"];
  return ["spouse", "child"];
}

export function baseCoverageMonths(type: QualifyingEventType): number {
  return EIGHTEEN_MONTH_EVENTS.has(type) ? FEDERAL.durationsMonths.standard : FEDERAL.durationsMonths.extended;
}

export type CoverageEndRule = "end_of_month" | "termination_date";

/** Last day of active coverage for a plan (TRG-3), when the source system doesn't provide it. */
export function lastDayOfCoverage(eventDate: IsoDate, rule: CoverageEndRule): IsoDate {
  if (rule === "termination_date") return eventDate;
  return addDays(addMonths(`${eventDate.slice(0, 7)}-01`, 1), -1);
}

/** COBRA coverage picks up the day after active coverage ends. */
export function cobraStartDate(lastCoveredDay: IsoDate): IsoDate {
  return addDays(lastCoveredDay, 1);
}

/** Last covered day of an N-month COBRA period starting on `cobraStart`. */
export function maxCoverageEndDate(cobraStart: IsoDate, months: number): IsoDate {
  return addDays(addMonths(cobraStart, months), -1);
}

export interface MaxCoverageInput {
  type: QualifyingEventType;
  relationship: Relationship;
  cobraStart: IsoDate;
  eventDate: IsoDate;
  /** Covered employee's Medicare entitlement date, when known. */
  employeeMedicareEntitlementDate?: IsoDate;
}

/**
 * Maximum coverage end date for one qualified beneficiary.
 *
 * Includes the Medicare rule: when a termination or reduction in hours happens
 * less than 18 months after the employee became entitled to Medicare, the
 * spouse and children get coverage until 36 months after the Medicare date.
 */
export function maxCoverageEnd(input: MaxCoverageInput): { months: number; endDate: IsoDate; rule: string } {
  const months = baseCoverageMonths(input.type);
  const standardEnd = maxCoverageEndDate(input.cobraStart, months);

  const medicare = input.employeeMedicareEntitlementDate;
  if (
    medicare &&
    EIGHTEEN_MONTH_EVENTS.has(input.type) &&
    input.relationship !== "employee" &&
    compareDates(medicare, input.eventDate) <= 0 &&
    compareDates(input.eventDate, addMonths(medicare, FEDERAL.durationsMonths.standard)) < 0
  ) {
    const medicareEnd = addDays(addMonths(medicare, FEDERAL.durationsMonths.extended), -1);
    if (compareDates(medicareEnd, standardEnd) > 0) {
      return { months: FEDERAL.durationsMonths.extended, endDate: medicareEnd, rule: "36 months from employee's Medicare entitlement" };
    }
  }

  return { months, endDate: standardEnd, rule: `${months} months from COBRA start` };
}

export interface DisabilityExtensionInput {
  cobraStart: IsoDate;
  originalMaxEnd: IsoDate;
  /** Date the SSA says the disability began. */
  disabilityOnsetDate: IsoDate;
  ssaDeterminationDate: IsoDate;
  /** When the beneficiary told us about the determination. */
  notifiedOn: IsoDate;
}

export interface ExtensionResult {
  eligible: boolean;
  newMaxEnd?: IsoDate;
  reason: string;
}

/**
 * 11-month disability extension (18 → 29 months) for the whole family. The
 * person must be disabled within the first 60 days of COBRA and notify us
 * within 60 days of the SSA determination and before the 18 months end.
 */
export function disabilityExtension(input: DisabilityExtensionInput): ExtensionResult {
  const lastOnsetDay = addDays(input.cobraStart, FEDERAL.disabilityDeterminationWindowDays - 1);
  if (compareDates(input.disabilityOnsetDate, lastOnsetDay) > 0) {
    return { eligible: false, reason: "Disability began after the first 60 days of COBRA coverage." };
  }
  if (daysBetween(input.ssaDeterminationDate, input.notifiedOn) > FEDERAL.beneficiaryNoticeDays) {
    return { eligible: false, reason: "Notice came more than 60 days after the SSA determination." };
  }
  if (compareDates(input.notifiedOn, input.originalMaxEnd) > 0) {
    return { eligible: false, reason: "Notice came after the original coverage period ended." };
  }
  return {
    eligible: true,
    newMaxEnd: maxCoverageEndDate(input.cobraStart, FEDERAL.durationsMonths.disability),
    reason: "Disability extension to 29 months.",
  };
}

export interface SecondEventInput {
  firstEventType: QualifyingEventType;
  secondEventType: QualifyingEventType;
  relationship: Relationship;
  cobraStart: IsoDate;
  currentMaxEnd: IsoDate;
  secondEventDate: IsoDate;
  notifiedOn: IsoDate;
}

/** A second 36-month event during an 18-month period extends spouse and children to 36 months from the first. */
export function secondEventExtension(input: SecondEventInput): ExtensionResult {
  if (!EIGHTEEN_MONTH_EVENTS.has(input.firstEventType)) {
    return { eligible: false, reason: "Only an 18-month period can be extended by a second event." };
  }
  if (input.relationship === "employee") {
    return { eligible: false, reason: "Second-event extensions apply to the spouse and children only." };
  }
  if (EIGHTEEN_MONTH_EVENTS.has(input.secondEventType)) {
    return { eligible: false, reason: "The second event must be a 36-month event." };
  }
  if (compareDates(input.secondEventDate, input.currentMaxEnd) > 0) {
    return { eligible: false, reason: "The second event happened after coverage ended." };
  }
  if (daysBetween(input.secondEventDate, input.notifiedOn) > FEDERAL.beneficiaryNoticeDays) {
    return { eligible: false, reason: "Notice came more than 60 days after the second event." };
  }
  return {
    eligible: true,
    newMaxEnd: maxCoverageEndDate(input.cobraStart, FEDERAL.durationsMonths.extended),
    reason: "Second qualifying event: 36 months from the original COBRA start.",
  };
}

/** Deadline for a beneficiary to report divorce, separation or a child aging out. */
export function beneficiaryReportDeadline(eventDate: IsoDate, lossOfCoverageDate: IsoDate): IsoDate {
  return addDays(laterOf(eventDate, lossOfCoverageDate), FEDERAL.beneficiaryNoticeDays);
}

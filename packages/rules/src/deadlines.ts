import { COMPANY_POLICY, FEDERAL, STATES } from "./config";
import {
  addDays,
  compareDates,
  daysBetween,
  earlierOf,
  laterOf,
  lastBusinessDayOnOrBefore,
  type IsoDate,
} from "./dates";
import { isEmployerReported, type QualifyingEventType } from "./events";

export interface EventDeadlineInput {
  type: QualifyingEventType;
  eventDate: IsoDate;
  /** Last day of active coverage. */
  lastCoveredDay: IsoDate;
  /** When COBRA on Demand (the administrator) learned of the event. */
  receivedOn: IsoDate;
  /** True when the employer itself is the plan administrator (44-day combined window). */
  employerIsAdministrator?: boolean;
}

export interface EventDeadlines {
  lossOfCoverageDate: IsoDate;
  /** Employer → administrator (30 days) or beneficiary → administrator (60 days). */
  reportDue: IsoDate;
  reportedLate: boolean;
  /** Legal deadline for the election notice. */
  electionNoticeDue: IsoDate;
  /** Internal target: last business day on or before the legal deadline. */
  electionNoticeSendBy: IsoDate;
  /** Ops is alerted from this date if the notice is still unsent. */
  opsAlertOn: IsoDate;
}

/**
 * Notice deadlines for a qualifying event.
 *
 * The reporting clock runs from the later of the event and the loss of
 * coverage. The election notice is due 14 days after the administrator
 * receives the event (or 44 days after the later date when the employer is
 * the administrator).
 */
export function computeEventDeadlines(input: EventDeadlineInput): EventDeadlines {
  const lossOfCoverageDate = addDays(input.lastCoveredDay, 1);
  const clockStart = laterOf(input.eventDate, lossOfCoverageDate);
  const reportDays = isEmployerReported(input.type) ? FEDERAL.employerNoticeDays : FEDERAL.beneficiaryNoticeDays;
  const reportDue = addDays(clockStart, reportDays);

  const electionNoticeDue = input.employerIsAdministrator
    ? addDays(clockStart, FEDERAL.electionNoticeDaysEmployerIsAdministrator)
    : addDays(input.receivedOn, FEDERAL.electionNoticeDays);

  const electionNoticeSendBy = lastBusinessDayOnOrBefore(electionNoticeDue);
  const opsAlertOn = addDays(electionNoticeSendBy, -COMPANY_POLICY.opsAlertDaysBeforeDeadline);

  return {
    lossOfCoverageDate,
    reportDue,
    reportedLate: compareDates(input.receivedOn, reportDue) > 0,
    electionNoticeDue,
    electionNoticeSendBy,
    opsAlertOn,
  };
}

/** Election window: at least 60 days from the later of the notice date and the loss of coverage. */
export function electionWindowEnd(noticeSentOn: IsoDate, lossOfCoverageDate: IsoDate): IsoDate {
  return addDays(laterOf(noticeSentOn, lossOfCoverageDate), FEDERAL.electionWindowDays);
}

/** First premium is due 45 days after the election (the postmark/submission date). */
export function initialPremiumDue(electedOn: IsoDate): IsoDate {
  return addDays(electedOn, FEDERAL.initialPremiumDays);
}

export function graceEnd(dueDate: IsoDate): IsoDate {
  return addDays(dueDate, FEDERAL.graceDays);
}

/** General (initial) notice to a newly covered employee and spouse. */
export function generalNoticeDue(coverageStart: IsoDate): IsoDate {
  return addDays(coverageStart, FEDERAL.generalNoticeDays);
}

/** CA AB 1401: the carrier's extension notice must go out within 180 days before federal COBRA ends. */
export function stateExtensionNoticeWindow(state: string, federalMaxEnd: IsoDate): { opens: IsoDate; closes: IsoDate } | null {
  const ext = STATES[state]?.extension;
  if (!ext) return null;
  return { opens: addDays(federalMaxEnd, -ext.noticeDaysBeforeFederalEnd), closes: federalMaxEnd };
}

export type Urgency = "overdue" | "critical" | "soon" | "ok";

/** Countdown shown on the employer dashboard for each pending event (TRG-13). */
export function deadlineUrgency(deadline: IsoDate, today: IsoDate): { daysLeft: number; urgency: Urgency } {
  const daysLeft = daysBetween(today, deadline);
  const urgency: Urgency =
    daysLeft < 0 ? "overdue" : daysLeft <= COMPANY_POLICY.opsAlertDaysBeforeDeadline ? "critical" : daysLeft <= 7 ? "soon" : "ok";
  return { daysLeft, urgency };
}

/**
 * Backdated terminations (TRG-8): if the send-by date has passed or is within
 * the ops alert window, the packet goes out immediately and people are told.
 */
export function mustSendImmediately(sendBy: IsoDate, today: IsoDate): boolean {
  return daysBetween(today, sendBy) <= COMPANY_POLICY.opsAlertDaysBeforeDeadline;
}

/** When a held event auto-proceeds without employer confirmation (TRG-6), never past the send-by date. */
export function autoProceedOn(detectedOn: IsoDate, holdDays: number, sendBy: IsoDate): IsoDate {
  return earlierOf(addDays(detectedOn, holdDays), sendBy);
}

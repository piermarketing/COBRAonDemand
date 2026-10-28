import { describe, expect, it } from "vitest";
import {
  autoProceedOn,
  computeEventDeadlines,
  deadlineUrgency,
  electionWindowEnd,
  generalNoticeDue,
  graceEnd,
  initialPremiumDue,
  mustSendImmediately,
  stateExtensionNoticeWindow,
} from "./deadlines";
import { annualRetest, determineRegime, isCobraEligiblePlanType } from "./eligibility";

describe("event deadlines", () => {
  it("gives the administrator 14 days from receipt to send the election notice", () => {
    const d = computeEventDeadlines({
      type: "termination",
      eventDate: "2026-10-15",
      lastCoveredDay: "2026-10-31",
      receivedOn: "2026-10-16",
    });
    expect(d.lossOfCoverageDate).toBe("2026-11-01");
    expect(d.reportDue).toBe("2026-12-01");
    expect(d.reportedLate).toBe(false);
    expect(d.electionNoticeDue).toBe("2026-10-30");
    expect(d.electionNoticeSendBy).toBe("2026-10-30");
    expect(d.opsAlertOn).toBe("2026-10-28");
  });

  it("moves a weekend send-by date back to Friday", () => {
    const d = computeEventDeadlines({
      type: "termination",
      eventDate: "2026-10-01",
      lastCoveredDay: "2026-10-31",
      receivedOn: "2026-10-17",
    });
    expect(d.electionNoticeDue).toBe("2026-10-31"); // Saturday
    expect(d.electionNoticeSendBy).toBe("2026-10-30");
  });

  it("uses the 44-day window when the employer administers the plan", () => {
    const d = computeEventDeadlines({
      type: "termination",
      eventDate: "2026-10-15",
      lastCoveredDay: "2026-10-31",
      receivedOn: "2026-10-16",
      employerIsAdministrator: true,
    });
    expect(d.electionNoticeDue).toBe("2026-12-15");
  });

  it("gives beneficiaries 60 days to report divorce and flags late reports", () => {
    const d = computeEventDeadlines({
      type: "divorce",
      eventDate: "2026-06-20",
      lastCoveredDay: "2026-06-30",
      receivedOn: "2026-09-15",
    });
    expect(d.reportDue).toBe("2026-08-30");
    expect(d.reportedLate).toBe(true);
  });

  it("computes the election window from the later of notice and loss of coverage", () => {
    expect(electionWindowEnd("2026-10-20", "2026-11-01")).toBe("2026-12-31");
    expect(electionWindowEnd("2026-11-10", "2026-11-01")).toBe("2027-01-09");
  });

  it("computes premium and notice dates", () => {
    expect(initialPremiumDue("2026-12-01")).toBe("2027-01-15");
    expect(graceEnd("2027-02-01")).toBe("2027-03-03");
    expect(generalNoticeDue("2026-01-01")).toBe("2026-04-01");
  });

  it("opens the CA extension notice window 180 days before federal COBRA ends", () => {
    expect(stateExtensionNoticeWindow("CA", "2028-04-30")).toEqual({ opens: "2027-11-02", closes: "2028-04-30" });
    expect(stateExtensionNoticeWindow("TX", "2028-04-30")).toBeNull();
  });

  it("rates deadline urgency for the dashboard", () => {
    expect(deadlineUrgency("2026-10-30", "2026-10-28")).toEqual({ daysLeft: 2, urgency: "critical" });
    expect(deadlineUrgency("2026-11-03", "2026-10-28").urgency).toBe("soon");
    expect(deadlineUrgency("2026-12-01", "2026-10-28").urgency).toBe("ok");
    expect(deadlineUrgency("2026-10-27", "2026-10-28").urgency).toBe("overdue");
  });

  it("sends backdated events immediately", () => {
    expect(mustSendImmediately("2026-10-29", "2026-10-28")).toBe(true);
    expect(mustSendImmediately("2026-11-10", "2026-10-28")).toBe(false);
  });

  it("never lets a hold run past the send-by date", () => {
    expect(autoProceedOn("2026-10-20", 3, "2026-11-02")).toBe("2026-10-23");
    expect(autoProceedOn("2026-10-30", 5, "2026-11-02")).toBe("2026-11-02");
  });
});

describe("eligibility", () => {
  it("accepts 20+ groups as federal and flags the CA extension", () => {
    const r = determineRegime({ priorYearEmployeeCount: 45, state: "CA", hasInsuredPlan: true });
    expect(r.regime).toBe("federal");
    expect(r.supported).toBe(true);
    expect(r.stateExtensionApplies).toBe(true);
  });

  it("does not apply the CA extension to self-funded plans", () => {
    expect(determineRegime({ priorYearEmployeeCount: 45, state: "CA", hasInsuredPlan: false }).stateExtensionApplies).toBe(false);
  });

  it("declines 2-19 groups in CA (Cal-COBRA is carrier-run)", () => {
    const r = determineRegime({ priorYearEmployeeCount: 12, state: "CA", hasInsuredPlan: true });
    expect(r.regime).toBe("state");
    expect(r.supported).toBe(false);
  });

  it("finds no regime for tiny or self-funded small groups", () => {
    expect(determineRegime({ priorYearEmployeeCount: 1, state: "CA", hasInsuredPlan: true }).regime).toBe("none");
    expect(determineRegime({ priorYearEmployeeCount: 10, state: "CA", hasInsuredPlan: false }).regime).toBe("none");
  });

  it("keeps current enrollees when a client drops under 20", () => {
    expect(annualRetest(18)).toMatchObject({ stillFederal: false, keepCurrentEnrollees: true, routeNewTerminationsToCarrier: true });
    expect(annualRetest(25).routeNewTerminationsToCarrier).toBe(false);
  });

  it("separates COBRA-eligible plan types", () => {
    expect(isCobraEligiblePlanType("medical")).toBe(true);
    expect(isCobraEligiblePlanType("health_fsa")).toBe(true);
    expect(isCobraEligiblePlanType("life")).toBe(false);
    expect(isCobraEligiblePlanType("disability")).toBe(false);
  });
});

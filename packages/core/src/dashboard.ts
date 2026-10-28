import { and, eq, inArray } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import {
  addDays,
  addMonths,
  compareDates,
  daysBetween,
  deadlineUrgency,
  endOfMonth,
  isActiveEnrollee,
  parseIsoDate,
  QB_STATUS_LABELS,
  startOfMonth,
  type IsoDate,
  type QbStatus,
} from "@cod/rules";
import { today } from "./env";

export type TimeFrame = "this_week" | "this_month" | "last_30" | "last_90" | "this_quarter" | "ytd" | "custom";

export function resolveTimeFrame(frame: TimeFrame, asOf: IsoDate, custom?: { from: IsoDate; to: IsoDate }): { from: IsoDate; to: IsoDate; label: string } {
  const dow = (parseIsoDate(asOf).getUTCDay() + 6) % 7; // Monday = 0
  switch (frame) {
    case "this_week":
      return { from: addDays(asOf, -dow), to: asOf, label: "This week" };
    case "last_30":
      return { from: addDays(asOf, -29), to: asOf, label: "Last 30 days" };
    case "last_90":
      return { from: addDays(asOf, -89), to: asOf, label: "Last 90 days" };
    case "this_quarter": {
      const m = parseIsoDate(asOf).getUTCMonth();
      const qStart = `${asOf.slice(0, 4)}-${String(m - (m % 3) + 1).padStart(2, "0")}-01`;
      return { from: qStart, to: asOf, label: "This quarter" };
    }
    case "ytd":
      return { from: `${asOf.slice(0, 4)}-01-01`, to: asOf, label: "Year to date" };
    case "custom":
      if (custom && compareDates(custom.from, custom.to) <= 0) return { ...custom, label: "Custom range" };
      return { from: startOfMonth(asOf), to: asOf, label: "This month" };
    default:
      return { from: startOfMonth(asOf), to: asOf, label: "This month" };
  }
}

const within = (d: string | null | undefined, from: string, to: string) => !!d && compareDates(d, from) >= 0 && compareDates(d, to) <= 0;

/** Employer home screen after go-live (section 8). One time frame drives every number except "as of today" tiles. */
export async function employerDashboard(companyId: string, frame: TimeFrame = "this_month", custom?: { from: IsoDate; to: IsoDate }) {
  const db = await getDb();
  const asOf = today();
  const range = resolveTimeFrame(frame, asOf, custom);
  const week = resolveTimeFrame("this_week", asOf);

  const [qbs, events, invoices] = await Promise.all([
    db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.companyId, companyId)),
    db
      .select({ event: tables.qualifyingEvents, firstName: tables.employees.firstName, lastName: tables.employees.lastName })
      .from(tables.qualifyingEvents)
      .innerJoin(tables.employees, eq(tables.employees.id, tables.qualifyingEvents.employeeId))
      .where(eq(tables.qualifyingEvents.companyId, companyId)),
    db.select().from(tables.premiumInvoices).where(and(eq(tables.premiumInvoices.companyId, companyId), inArray(tables.premiumInvoices.status, ["open", "paid", "shortfall_cure", "lapsed"]))),
  ]);
  const payments = invoices.length ? await db.select().from(tables.payments).where(and(inArray(tables.payments.invoiceId, invoices.map((i) => i.id)), eq(tables.payments.status, "succeeded"))) : [];
  const elections = await db.select().from(tables.elections).where(eq(tables.elections.companyId, companyId));
  const eventById = new Map(events.map((e) => [e.event.id, e.event]));

  const active = qbs.filter((q) => q.status === "active" || q.status === "grace");
  const tiles = {
    activeEnrollees: active.length,
    activeHouseholds: new Set(active.map((q) => q.eventId)).size,
    newThisWeek: qbs.filter((q) => within(q.electedOn, week.from, week.to)).length,
    newThisMonth: qbs.filter((q) => within(q.electedOn, startOfMonth(asOf), asOf)).length,
    newInRange: qbs.filter((q) => within(q.electedOn, range.from, range.to)).length,
  };

  const inRange = invoices.filter((i) => within(i.dueDate, range.from, range.to));
  const paidByInvoice = new Map<string, number>();
  for (const p of payments) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amount);
  const premium = {
    billed: inRange.reduce((s, i) => s + i.amountDue + i.subsidyAmount, 0),
    collected: payments.filter((p) => within(p.paidOn, range.from, range.to)).reduce((s, p) => s + p.amount, 0),
    outstanding: inRange.filter((i) => i.status === "open" || i.status === "shortfall_cure").reduce((s, i) => s + i.amountDue - (paidByInvoice.get(i.id) ?? 0), 0),
    employerSubsidy: inRange.reduce((s, i) => s + i.subsidyAmount, 0),
  };

  const pendingElections = qbs
    .filter((q) => (q.status === "notice_sent" || q.status === "waived") && q.electionDeadline)
    .map((q) => ({ id: q.id, name: `${q.firstName} ${q.lastName}`, relationship: q.relationship, deadline: q.electionDeadline!, daysLeft: daysBetween(asOf, q.electionDeadline!) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const endedInRange = qbs.filter((q) => (q.status === "terminated" || q.status === "expired") && within(q.terminatedOn ?? q.electionDeadline, range.from, range.to));
  const endedByReason: Record<string, number> = {};
  for (const q of endedInRange) {
    const reason = q.status === "expired" ? "did_not_elect" : q.terminationReason ?? "other";
    endedByReason[reason] = (endedByReason[reason] ?? 0) + 1;
  }

  const months: string[] = [];
  for (let m = startOfMonth(range.from); compareDates(m, range.to) <= 0; m = addMonths(m, 1)) months.push(m);
  const trend = months.slice(-12).map((m) => {
    const end = endOfMonth(m);
    const enrolled = qbs.filter(
      (q) => q.electedOn && compareDates(q.cobraStart, end) <= 0 && compareDates(q.electedOn, end) <= 0 && (!q.terminatedOn || compareDates(q.terminatedOn, m) >= 0) && ["active", "grace", "terminated", "elected"].includes(q.status),
    ).length;
    const collected = payments.filter((p) => p.paidOn.startsWith(m.slice(0, 7))).reduce((s, p) => s + p.amount, 0);
    return { month: m.slice(0, 7), enrolled, collected };
  });

  const watch = {
    inGrace: qbs.filter((q) => q.status === "grace").map((q) => ({ id: q.id, name: `${q.firstName} ${q.lastName}` })),
    ending30: active.filter((q) => daysBetween(asOf, q.maxCoverageEnd) <= 30).map((q) => ({ id: q.id, name: `${q.firstName} ${q.lastName}`, endDate: q.maxCoverageEnd })),
    ending60: active.filter((q) => { const d = daysBetween(asOf, q.maxCoverageEnd); return d > 30 && d <= 60; }).map((q) => ({ id: q.id, name: `${q.firstName} ${q.lastName}`, endDate: q.maxCoverageEnd })),
  };

  const pendingEvents = events
    .filter((e) => ["pending_confirmation", "scheduled", "ready"].includes(e.event.status))
    .map((e) => ({ ...e.event, name: `${e.firstName} ${e.lastName}`, ...deadlineUrgency(e.event.sendBy, asOf) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Enrollee table: one row per qualified beneficiary.
  const lastPaidThrough = new Map<string, string>();
  for (const i of invoices.filter((x) => x.status === "paid")) {
    const cur = lastPaidThrough.get(i.eventId);
    if (!cur || compareDates(i.periodEnd, cur) > 0) lastPaidThrough.set(i.eventId, i.periodEnd);
  }
  const latestMonthly = new Map<string, (typeof invoices)[number]>();
  for (const i of invoices) {
    const cur = latestMonthly.get(i.eventId);
    if (!cur || compareDates(i.periodStart, cur.periodStart) > 0) latestMonthly.set(i.eventId, i);
  }
  const planNames = new Map<string, string>();
  for (const e of events) for (const p of e.event.coverageSnapshot?.plans ?? []) planNames.set(p.planId, p.name);
  const enrollees = qbs
    .filter((q) => !["cancelled", "pending_notice"].includes(q.status))
    .map((q) => {
      const elected = elections.filter((el) => el.qbId === q.id && el.decision === "elect").map((el) => planNames.get(el.planId) ?? "Plan");
      const inv = latestMonthly.get(q.eventId);
      return {
        id: q.id,
        name: `${q.firstName} ${q.lastName}`,
        relationship: q.relationship,
        plans: [...new Set(elected)],
        cobraStart: q.cobraStart,
        maxCoverageEnd: q.maxCoverageEnd,
        paidThrough: lastPaidThrough.get(q.eventId) ?? null,
        householdMonthly: inv?.lines.reduce((s, l) => s + l.amount, 0) ?? 0,
        subsidy: eventById.get(q.eventId)?.subsidyPercent ?? 0,
        status: q.status as QbStatus,
        statusLabel: QB_STATUS_LABELS[q.status as QbStatus] ?? q.status,
        bucket: q.status === "active" ? "Active" : q.status === "grace" ? "Grace" : q.status === "notice_sent" || q.status === "elected" || q.status === "waived" ? "Pending" : "Ended",
      };
    });

  const premiumByPlan = new Map<string, { plan: string; enrollees: number; premium: number }>();
  for (const i of inRange) {
    for (const l of i.lines) {
      const row = premiumByPlan.get(l.planName) ?? { plan: l.planName, enrollees: 0, premium: 0 };
      row.premium += l.amount;
      premiumByPlan.set(l.planName, row);
    }
  }
  for (const q of active) {
    for (const el of elections.filter((x) => x.qbId === q.id && x.decision === "elect")) {
      const name = planNames.get(el.planId);
      if (!name) continue;
      const row = premiumByPlan.get(name) ?? { plan: name, enrollees: 0, premium: 0 };
      row.enrollees += 1;
      premiumByPlan.set(name, row);
    }
  }

  return { asOf, range, tiles, premium, pendingElections, endedByReason, trend, watch, pendingEvents, enrollees, premiumByPlan: [...premiumByPlan.values()], activeCount: qbs.filter((q) => isActiveEnrollee(q.status as QbStatus)).length };
}

import { and, eq, inArray, isNull, lte, or, gte } from "drizzle-orm";
import { getDb, tables, type CoverageSnapshot } from "@cod/db";
import {
  assertTransition,
  autoProceedOn,
  cobraStartDate,
  compareDates,
  computeEventDeadlines,
  eligibleRelationships,
  lastDayOfCoverage,
  laterOf,
  maxCoverageEnd,
  mustSendImmediately,
  type QbStatus,
  type QualifyingEventType,
} from "@cod/rules";
import { audit, SYSTEM, type Actor } from "./audit";
import { getCompany, UserError } from "./companies";
import { today } from "./env";
import { sendEmail } from "./messaging";
import { openTask } from "./tasks";

export interface CreateEventInput {
  companyId: string;
  employeeId: string;
  type: QualifyingEventType;
  eventDate: string;
  source: "sync" | "census" | "manual" | "beneficiary";
  reason?: string;
  /** The dependent losing coverage, for divorce, separation or a child aging out. */
  dependentId?: string;
  /** Last covered day when the source provides it (TRG-3). */
  lastCoveredDay?: string;
  grossMisconduct?: { reason: string; confirmed: boolean };
  subsidy?: { months: number; percent: number } | null;
  actor: Actor;
}

/** Latest rate per tier effective on a date (PLN-11: rate history by effective date). */
function ratesAsOf(rates: (typeof tables.planRates.$inferSelect)[], planId: string, asOf: string) {
  const byTier = new Map<string, (typeof rates)[number]>();
  for (const r of rates) {
    if (r.planId !== planId || compareDates(r.effectiveFrom, asOf) > 0) continue;
    const cur = byTier.get(r.tier);
    if (!cur || compareDates(r.effectiveFrom, cur.effectiveFrom) > 0) byTier.set(r.tier, r);
  }
  // Fall back to the earliest rates when none are effective yet (new plan year loaded early).
  if (byTier.size === 0) {
    for (const r of rates.filter((x) => x.planId === planId)) if (!byTier.has(r.tier)) byTier.set(r.tier, r);
  }
  return [...byTier.values()].map((r) => ({ tier: r.tier, monthlyCost: r.monthlyCost }));
}

/**
 * Create a qualifying event and its qualified beneficiaries (TRG-2 … TRG-11,
 * QE-1). Freezes the coverage snapshot (INT-15), computes every deadline with
 * the rules engine and decides whether the packet goes out now, waits for a
 * one-tap employer confirmation, or waits for a future termination date.
 */
export async function createQualifyingEvent(input: CreateEventInput) {
  const db = await getDb();
  const company = await getCompany(input.companyId);
  const asOf = today();

  if (input.grossMisconduct && (!input.grossMisconduct.confirmed || input.grossMisconduct.reason.trim().length < 10)) {
    throw new UserError("Gross misconduct needs a written reason and a second confirmation (TRG-11).", "grossMisconduct");
  }

  const [employee] = await db
    .select()
    .from(tables.employees)
    .where(and(eq(tables.employees.id, input.employeeId), eq(tables.employees.companyId, input.companyId)));
  if (!employee) throw new UserError("Employee not found.");

  const duplicate = await db
    .select({ id: tables.qualifyingEvents.id })
    .from(tables.qualifyingEvents)
    .where(
      and(
        eq(tables.qualifyingEvents.employeeId, employee.id),
        eq(tables.qualifyingEvents.type, input.type),
        eq(tables.qualifyingEvents.eventDate, input.eventDate),
        inArray(tables.qualifyingEvents.status, ["pending_confirmation", "scheduled", "ready", "sent", "needs_review"]),
      ),
    );
  if (duplicate.length) return { id: duplicate[0]!.id, duplicate: true as const };

  const covs = await db
    .select()
    .from(tables.coverages)
    .where(
      and(
        eq(tables.coverages.employeeId, employee.id),
        lte(tables.coverages.startDate, input.eventDate),
        or(isNull(tables.coverages.endDate), gte(tables.coverages.endDate, input.eventDate)),
      ),
    );
  const planRows = covs.length ? await db.select().from(tables.plans).where(inArray(tables.plans.id, [...new Set(covs.map((c) => c.planId))])) : [];
  const eligiblePlans = planRows.filter((p) => p.cobraEligible);
  const eligibleCovs = covs.filter((c) => eligiblePlans.some((p) => p.id === c.planId));

  const deps = await db.select().from(tables.dependents).where(eq(tables.dependents.employeeId, employee.id));
  const lastCovered =
    input.lastCoveredDay ??
    eligiblePlans.map((p) => lastDayOfCoverage(input.eventDate, p.coverageEndRule)).reduce((a, b) => laterOf(a, b), input.eventDate);

  const deadlines = computeEventDeadlines({ type: input.type, eventDate: input.eventDate, lastCoveredDay: lastCovered, receivedOn: asOf });
  const cobraStart = cobraStartDate(lastCovered);

  // TRG-4: no COBRA-eligible coverage the day before coverage ends → log only, no packet, no charge.
  if (eligibleCovs.length === 0) {
    const [ev] = await db
      .insert(tables.qualifyingEvents)
      .values({
        companyId: company.id,
        employeeId: employee.id,
        type: input.type,
        eventDate: input.eventDate,
        lastCoveredDay: lastCovered,
        lossOfCoverageDate: deadlines.lossOfCoverageDate,
        receivedOn: asOf,
        reportDue: deadlines.reportDue,
        electionNoticeDue: deadlines.electionNoticeDue,
        sendBy: deadlines.electionNoticeSendBy,
        status: "no_coverage",
        source: input.source,
        reason: input.reason,
        reportedBy: input.actor.id ?? null,
      })
      .returning();
    await audit(input.actor, { companyId: company.id, action: "event.no_coverage", entityType: "qualifying_event", entityId: ev!.id });
    return { id: ev!.id, duplicate: false as const, status: "no_coverage" as const };
  }

  const allRates = await db.select().from(tables.planRates).where(inArray(tables.planRates.planId, eligiblePlans.map((p) => p.id)));
  const employeeTierFor = (planId: string) => eligibleCovs.find((c) => c.planId === planId && !c.dependentId)?.tier ?? eligibleCovs.find((c) => c.planId === planId)!.tier;

  const people: CoverageSnapshot["people"] = [
    {
      personKey: `employee:${employee.id}`,
      dependentId: null,
      relationship: "employee" as const,
      firstName: employee.firstName,
      lastName: employee.lastName,
      planIds: eligibleCovs.filter((c) => !c.dependentId).map((c) => c.planId),
      address: employee.address,
      email: employee.email,
    },
    ...deps.map((d) => ({
      personKey: `dependent:${d.id}`,
      dependentId: d.id,
      relationship: d.relationship,
      firstName: d.firstName,
      lastName: d.lastName,
      planIds: eligibleCovs.filter((c) => c.dependentId === d.id).map((c) => c.planId),
      address: d.address ?? employee.address,
      email: d.email,
    })),
  ].filter((p) => p.planIds.length > 0);

  const snapshot: CoverageSnapshot = {
    takenAt: new Date().toISOString(),
    plans: eligiblePlans.map((p) => ({
      planId: p.id,
      code: p.code,
      name: p.name,
      carrier: p.carrierName,
      type: p.type,
      insured: p.insured,
      tier: employeeTierFor(p.id),
      rates: ratesAsOf(allRates, p.id, lastCovered),
    })),
    people,
  };

  // Who becomes a qualified beneficiary for this event.
  const allowed = eligibleRelationships(input.type);
  let qbPeople = people.filter((p) => allowed.includes(p.relationship));
  if (input.type === "divorce" || input.type === "legal_separation") qbPeople = qbPeople.filter((p) => p.relationship === "spouse");
  if (input.type === "dependent_loss_of_status") {
    if (!input.dependentId) throw new UserError("Choose the child who is losing dependent status.", "dependentId");
    qbPeople = qbPeople.filter((p) => p.dependentId === input.dependentId);
  }
  if (qbPeople.length === 0) throw new UserError("No one covered on a COBRA-eligible plan is affected by this event.");

  const futureDated = compareDates(input.eventDate, asOf) > 0;
  const urgent = mustSendImmediately(deadlines.electionNoticeSendBy, asOf);
  const hold = (input.source === "sync" || input.source === "census") && company.settings.sendMode === "hold" && !urgent;
  const status = futureDated ? "scheduled" : hold ? "pending_confirmation" : "ready";
  const subsidy = input.subsidy === undefined ? company.settings.defaultSubsidy ?? null : input.subsidy;

  const event = await db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(tables.qualifyingEvents)
      .values({
        companyId: company.id,
        employeeId: employee.id,
        dependentId: input.dependentId ?? null,
        type: input.type,
        eventDate: input.eventDate,
        lastCoveredDay: lastCovered,
        lossOfCoverageDate: deadlines.lossOfCoverageDate,
        receivedOn: asOf,
        reportDue: deadlines.reportDue,
        electionNoticeDue: deadlines.electionNoticeDue,
        sendBy: deadlines.electionNoticeSendBy,
        autoProceedOn: hold ? autoProceedOn(asOf, company.settings.autoProceedDays, deadlines.electionNoticeSendBy) : null,
        status,
        source: input.source,
        reason: input.reason ?? null,
        grossMisconduct: Boolean(input.grossMisconduct),
        subsidyMonths: subsidy?.months ?? null,
        subsidyPercent: subsidy?.percent ?? null,
        coverageSnapshot: snapshot,
        reportedBy: input.actor.id ?? null,
        confirmedAt: status === "ready" ? new Date() : null,
      })
      .returning();
    await tx.insert(tables.qualifiedBeneficiaries).values(
      qbPeople.map((p) => ({
        companyId: company.id,
        eventId: ev!.id,
        employeeId: employee.id,
        dependentId: p.dependentId,
        relationship: p.relationship,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        address: p.address,
        cobraStart,
        maxCoverageEnd: maxCoverageEnd({ type: input.type, relationship: p.relationship, cobraStart, eventDate: input.eventDate }).endDate,
      })),
    );
    return ev!;
  });

  await audit(input.actor, {
    companyId: company.id,
    action: "event.created",
    entityType: "qualifying_event",
    entityId: event.id,
    after: { type: input.type, eventDate: input.eventDate, status, sendBy: deadlines.electionNoticeSendBy, beneficiaries: qbPeople.length },
  });

  const name = `${employee.firstName} ${employee.lastName}`;
  if (deadlines.reportedLate) {
    await openTask({ companyId: company.id, type: "late_event", title: `Late qualifying event: ${name}`, detail: `Reported ${asOf}; employer deadline was ${deadlines.reportDue}.`, entityType: "qualifying_event", entityId: event.id, dueAt: deadlines.electionNoticeSendBy });
  }
  if (urgent && !futureDated) {
    // TRG-8: backdated entry close to the legal deadline → send now and tell everyone.
    await openTask({ companyId: company.id, type: "deadline_risk", title: `Backdated event sent immediately: ${name}`, detail: `Notice due ${deadlines.electionNoticeDue}.`, entityType: "qualifying_event", entityId: event.id, dueAt: deadlines.electionNoticeDue });
    if (company.hrContactEmail) {
      await sendEmail(company.hrContactEmail, `Backdated termination: COBRA packet sent today for ${name}`, `The termination for ${name} was entered close to the legal notice deadline (${deadlines.electionNoticeDue}), so the election packet is going out immediately.`, { companyId: company.id, relatedType: "qualifying_event", relatedId: event.id });
    }
  }
  if (status === "pending_confirmation" && company.hrContactEmail) {
    await sendEmail(
      company.hrContactEmail,
      `Confirm COBRA event: ${name}`,
      `We detected a ${input.type.replace(/_/g, " ")} for ${name} on ${input.eventDate}. Confirm or reject it in your dashboard. If we don't hear from you, the packet goes out automatically on ${event.autoProceedOn}.`,
      { companyId: company.id, relatedType: "qualifying_event", relatedId: event.id },
    );
  }

  if (status === "ready") {
    const { sendEventPackets } = await import("./notices");
    await sendEventPackets(event.id, input.actor);
  }
  return { id: event.id, duplicate: false as const, status };
}

export async function getEvent(companyId: string, eventId: string) {
  const db = await getDb();
  const [ev] = await db
    .select()
    .from(tables.qualifyingEvents)
    .where(and(eq(tables.qualifyingEvents.id, eventId), eq(tables.qualifyingEvents.companyId, companyId)));
  if (!ev) throw new UserError("Event not found.");
  return ev;
}

/** One-tap employer confirmation of a detected event (TRG-6). */
export async function confirmEvent(companyId: string, eventId: string, actor: Actor) {
  const db = await getDb();
  const ev = await getEvent(companyId, eventId);
  if (ev.status !== "pending_confirmation") throw new UserError("This event isn't waiting for confirmation.");
  await db.update(tables.qualifyingEvents).set({ status: "ready", confirmedAt: new Date() }).where(eq(tables.qualifyingEvents.id, ev.id));
  await audit(actor, { companyId, action: "event.confirmed", entityType: "qualifying_event", entityId: ev.id });
  const { sendEventPackets } = await import("./notices");
  await sendEventPackets(ev.id, actor);
}

/**
 * Reversal (TRG-9): a rehire or deleted termination before mailing cancels
 * the event; after mailing it opens an ops task instead.
 */
export async function cancelEvent(companyId: string, eventId: string, reason: string, actor: Actor) {
  const db = await getDb();
  const ev = await getEvent(companyId, eventId);
  if (ev.status === "sent") {
    await openTask({ companyId, type: "reversal_after_mailing", title: "Termination reversed after the packet was sent", detail: reason, entityType: "qualifying_event", entityId: ev.id });
    await audit(actor, { companyId, action: "event.reversal_requested", entityType: "qualifying_event", entityId: ev.id, after: { reason } });
    return { cancelled: false as const };
  }
  if (["cancelled", "no_coverage"].includes(ev.status)) return { cancelled: true as const };
  const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, ev.id));
  for (const qb of qbs) assertTransition(qb.status as QbStatus, "cancelled");
  await db.transaction(async (tx) => {
    await tx.update(tables.qualifyingEvents).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason }).where(eq(tables.qualifyingEvents.id, ev.id));
    await tx.update(tables.qualifiedBeneficiaries).set({ status: "cancelled" }).where(eq(tables.qualifiedBeneficiaries.eventId, ev.id));
  });
  await audit(actor, { companyId, action: "event.cancelled", entityType: "qualifying_event", entityId: ev.id, after: { reason } });
  return { cancelled: true as const };
}

/** Cancel open events for an employee whose termination was removed in the source system. */
export async function cancelEventsForEmployee(companyId: string, employeeId: string, reason: string) {
  const db = await getDb();
  const open = await db
    .select()
    .from(tables.qualifyingEvents)
    .where(and(eq(tables.qualifyingEvents.employeeId, employeeId), inArray(tables.qualifyingEvents.status, ["pending_confirmation", "scheduled", "ready", "sent"])));
  for (const ev of open) await cancelEvent(companyId, ev.id, reason, SYSTEM);
}

export async function listEvents(companyId: string) {
  const db = await getDb();
  return db
    .select({
      event: tables.qualifyingEvents,
      employee: { firstName: tables.employees.firstName, lastName: tables.employees.lastName },
    })
    .from(tables.qualifyingEvents)
    .innerJoin(tables.employees, eq(tables.employees.id, tables.qualifyingEvents.employeeId))
    .where(eq(tables.qualifyingEvents.companyId, companyId));
}

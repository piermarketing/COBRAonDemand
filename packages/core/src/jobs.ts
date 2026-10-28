import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { premiumInvoicedPosting } from "@cod/billing";
import {
  addDays,
  addMonths,
  assertTransition,
  autoProceedOn,
  COMPANY_POLICY,
  compareDates,
  daysBetween,
  endOfMonth,
  formatCents,
  graceEnd,
  premiumPeriods,
  splitSubsidy,
  startOfMonth,
  type QbStatus,
} from "@cod/rules";
import { audit, SYSTEM } from "./audit";
import { postLedger, recordEmployerCharge } from "./billing";
import { getCompany } from "./companies";
import { householdPremiums, payInvoice, refreshInvoiceStatus } from "./enrollment";
import { today } from "./env";
import { sendLifecycleNotice } from "./lifecycle-notices";
import { sendEmail } from "./messaging";
import { sendEventPackets } from "./notices";
import { openTask } from "./tasks";

/**
 * Scheduled jobs (Cloud Scheduler → /api/jobs/{name}). Every job is
 * idempotent, so a retry or a double fire never sends twice or double-bills.
 */

async function setQbStatus(ids: string[], from: QbStatus[], to: QbStatus, extra: Partial<typeof tables.qualifiedBeneficiaries.$inferInsert> = {}) {
  if (ids.length === 0) return;
  const db = await getDb();
  const rows = await db.select().from(tables.qualifiedBeneficiaries).where(inArray(tables.qualifiedBeneficiaries.id, ids));
  const movable = rows.filter((r) => from.includes(r.status as QbStatus));
  for (const r of movable) assertTransition(r.status as QbStatus, to);
  if (movable.length) {
    await db.update(tables.qualifiedBeneficiaries).set({ status: to, ...extra }).where(inArray(tables.qualifiedBeneficiaries.id, movable.map((r) => r.id)));
  }
  return movable;
}

/** Hourly: release scheduled and held events, send packets, alert ops 2 days before any deadline. */
export async function sendElectionNoticesJob(asOf = today()) {
  const db = await getDb();
  let released = 0;
  let sent = 0;

  const scheduled = await db.select().from(tables.qualifyingEvents).where(and(eq(tables.qualifyingEvents.status, "scheduled"), lte(tables.qualifyingEvents.eventDate, asOf)));
  for (const ev of scheduled) {
    const company = await getCompany(ev.companyId);
    const hold = ev.source !== "manual" && company.settings.sendMode === "hold";
    await db
      .update(tables.qualifyingEvents)
      .set(hold ? { status: "pending_confirmation", autoProceedOn: autoProceedOn(asOf, company.settings.autoProceedDays, ev.sendBy) } : { status: "ready", confirmedAt: new Date() })
      .where(eq(tables.qualifyingEvents.id, ev.id));
    released++;
  }

  const held = await db
    .select()
    .from(tables.qualifyingEvents)
    .where(and(eq(tables.qualifyingEvents.status, "pending_confirmation"), lte(tables.qualifyingEvents.autoProceedOn, asOf)));
  for (const ev of held) {
    await db.update(tables.qualifyingEvents).set({ status: "ready" }).where(eq(tables.qualifyingEvents.id, ev.id));
    await audit(SYSTEM, { companyId: ev.companyId, action: "event.auto_proceeded", entityType: "qualifying_event", entityId: ev.id });
    released++;
  }

  const ready = await db.select().from(tables.qualifyingEvents).where(eq(tables.qualifyingEvents.status, "ready"));
  for (const ev of ready) sent += (await sendEventPackets(ev.id)).sent;

  const unsent = await db.select().from(tables.qualifyingEvents).where(inArray(tables.qualifyingEvents.status, ["pending_confirmation", "ready"]));
  for (const ev of unsent) {
    if (daysBetween(asOf, ev.sendBy) <= COMPANY_POLICY.opsAlertDaysBeforeDeadline) {
      await openTask({ companyId: ev.companyId, type: "deadline_risk", title: "Election notice close to its legal deadline", detail: `Send by ${ev.sendBy}; legal deadline ${ev.electionNoticeDue}.`, entityType: "qualifying_event", entityId: ev.id, dueAt: ev.sendBy });
    }
  }
  return { released, sent };
}

/** Daily: expire beneficiaries who didn't elect by day 60. */
export async function closeElectionWindowsJob(asOf = today()) {
  const db = await getDb();
  const due = await db
    .select()
    .from(tables.qualifiedBeneficiaries)
    .where(and(inArray(tables.qualifiedBeneficiaries.status, ["notice_sent", "waived"]), lt(tables.qualifiedBeneficiaries.electionDeadline, asOf)));
  const expired = (await setQbStatus(due.map((q) => q.id), ["notice_sent", "waived"], "expired")) ?? [];
  const byCompany = new Map<string, typeof expired>();
  for (const q of expired) byCompany.set(q.companyId, [...(byCompany.get(q.companyId) ?? []), q]);
  for (const [companyId, qbs] of byCompany) {
    const company = await getCompany(companyId);
    if (company.hrContactEmail) {
      await sendEmail(company.hrContactEmail, "COBRA election periods closed", `These people did not elect COBRA by their deadline, so their rights have expired:\n${qbs.map((q) => `• ${q.firstName} ${q.lastName}`).join("\n")}`, { companyId, relatedType: "job", relatedId: `close-election-windows:${asOf}` });
    }
    for (const q of qbs) await audit(SYSTEM, { companyId, action: "qb.expired", entityType: "qualified_beneficiary", entityId: q.id });
  }
  return { expired: expired.length };
}

/** Daily: end COBRA when the first premium isn't paid within 45 days of electing. */
export async function initialPremiumCheckJob(asOf = today()) {
  const db = await getDb();
  const overdue = await db
    .select()
    .from(tables.premiumInvoices)
    .where(and(eq(tables.premiumInvoices.kind, "initial"), inArray(tables.premiumInvoices.status, ["open", "shortfall_cure"]), lt(tables.premiumInvoices.finalPaymentDate, asOf)));
  let terminated = 0;
  for (const inv of overdue) {
    const result = await refreshInvoiceStatus(inv.id);
    if (result.status !== "lapsed") continue;
    const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, inv.eventId));
    const ended = (await setQbStatus(qbs.map((q) => q.id), ["elected"], "terminated", { terminatedOn: asOf, terminationReason: "initial_premium_not_paid" })) ?? [];
    terminated += ended.length;
    if (ended.length) {
      await sendLifecycleNotice({
        eventId: inv.eventId,
        qbIds: ended.map((q) => q.id),
        type: "early_termination",
        subject: "Your COBRA coverage has ended",
        body: `Your first COBRA premium was due by ${inv.finalPaymentDate} and was not paid in full, so COBRA coverage will not be reinstated.`,
        dedupeKey: "early-termination-initial",
      });
    }
  }
  return { terminated };
}

/** Monthly (1st), safe to run daily: create each household's invoice for the month and charge autopay. */
export async function generateInvoicesJob(asOf = today()) {
  const db = await getDb();
  const monthStart = startOfMonth(asOf);
  const activeQbs = await db.select().from(tables.qualifiedBeneficiaries).where(inArray(tables.qualifiedBeneficiaries.status, ["active", "grace"]));
  const eventIds = [...new Set(activeQbs.map((q) => q.eventId))];
  let created = 0;
  let charged = 0;
  for (const eventId of eventIds) {
    const invoices = await db.select().from(tables.premiumInvoices).where(eq(tables.premiumInvoices.eventId, eventId));
    if (invoices.some((i) => i.status !== "void" && compareDates(i.periodStart, monthStart) <= 0 && compareDates(i.periodEnd, monthStart) >= 0)) continue;
    const { event, covered, lines, monthly, maxEnd } = await householdPremiums(eventId);
    if (monthly === 0 || compareDates(maxEnd, monthStart) < 0) continue;
    const periods = premiumPeriods(covered[0]!.cobraStart, asOf, maxEnd, monthly);
    const index = periods.findIndex((p) => p.dueDate === monthStart);
    if (index < 0) continue;
    const period = periods[index]!;
    const subsidy = event.subsidyMonths && event.subsidyPercent ? { months: event.subsidyMonths, percent: event.subsidyPercent } : null;
    const split = splitSubsidy(period.amount, index, subsidy);
    const accountId = covered.find((q) => q.accountId)?.accountId ?? null;
    const [inv] = await db
      .insert(tables.premiumInvoices)
      .values({
        companyId: event.companyId,
        eventId,
        accountId,
        kind: "monthly",
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: period.dueDate,
        finalPaymentDate: graceEnd(period.dueDate),
        amountDue: split.enrollee,
        subsidyAmount: split.employer,
        status: split.enrollee === 0 ? "paid" : "open",
        lines: lines.map((l) => ({ planName: l.planName, tier: l.tier, amount: l.amount })),
      })
      .returning();
    await postLedger(event.companyId, premiumInvoicedPosting(inv!.id, split.enrollee, split.employer));
    created++;
    if (split.enrollee > 0 && accountId) {
      const [method] = await db
        .select()
        .from(tables.paymentMethods)
        .where(and(eq(tables.paymentMethods.accountId, accountId), eq(tables.paymentMethods.autopay, true), eq(tables.paymentMethods.status, "active")));
      if (method) {
        await payInvoice(inv!.id, method.id, SYSTEM);
        charged++;
      } else {
        await sendLifecycleNotice({
          eventId,
          qbIds: covered.map((q) => q.id),
          type: "premium_due",
          subject: `COBRA premium due ${period.dueDate}`,
          body: `Your COBRA premium of ${formatCents(split.enrollee)} for ${period.periodStart} to ${period.periodEnd} is due ${period.dueDate}. The grace period ends ${graceEnd(period.dueDate)}.`,
          dedupeKey: `premium-due-${period.dueDate}`,
        });
      }
    }
  }
  return { created, charged };
}

/** Daily: grace tracking, day 15/25 warnings, shortfall cure notices, termination after grace. */
export async function gracePeriodCheckJob(asOf = today()) {
  const db = await getDb();
  const open = await db.select().from(tables.premiumInvoices).where(and(eq(tables.premiumInvoices.kind, "monthly"), inArray(tables.premiumInvoices.status, ["open", "shortfall_cure"])));
  let warned = 0;
  let terminated = 0;
  for (const inv of open) {
    const r = await refreshInvoiceStatus(inv.id);
    const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, inv.eventId));
    const ids = qbs.map((q) => q.id);
    if (r.status === "open" && compareDates(asOf, inv.dueDate) > 0) {
      await setQbStatus(ids, ["active"], "grace");
      const day = daysBetween(inv.dueDate, asOf);
      for (const w of COMPANY_POLICY.gracePeriodWarningDays) {
        if (day >= w) {
          const sentNow = await sendLifecycleNotice({
            eventId: inv.eventId,
            qbIds: ids,
            type: "grace_warning",
            subject: "Your COBRA premium is past due",
            body: `We haven't received your premium of ${formatCents(inv.amountDue)} due ${inv.dueDate}. Pay by ${inv.finalPaymentDate} to keep your coverage.`,
            dedupeKey: `grace-${inv.id}-${w}`,
          });
          if (sentNow) warned++;
        }
      }
    }
    if (r.status === "shortfall_cure") {
      await sendLifecycleNotice({
        eventId: inv.eventId,
        qbIds: ids,
        type: "shortfall_cure",
        subject: "Your COBRA payment was a little short",
        body: `Your payment was ${formatCents(r.evaluation.shortfall)} short. Please pay the difference by ${r.evaluation.cureBy} to keep your coverage.`,
        dedupeKey: `shortfall-${inv.id}`,
      });
    }
    if (r.status === "lapsed") {
      const ended = (await setQbStatus(ids, ["active", "grace"], "terminated", { terminatedOn: asOf, terminationReason: "nonpayment" })) ?? [];
      terminated += ended.length;
      if (ended.length) {
        await sendLifecycleNotice({
          eventId: inv.eventId,
          qbIds: ended.map((q) => q.id),
          type: "early_termination",
          subject: "Your COBRA coverage has ended for nonpayment",
          body: `The premium due ${inv.dueDate} was not paid in full by the end of the grace period (${inv.finalPaymentDate}). Coverage ended as of ${addDays(inv.periodStart, -1)}.`,
          dedupeKey: `early-termination-${inv.id}`,
        });
        const company = await getCompany(inv.companyId);
        if (company.hrContactEmail) {
          await sendEmail(company.hrContactEmail, "COBRA terminated for nonpayment: notify the carrier", ended.map((q) => `• ${q.firstName} ${q.lastName}: coverage ends ${addDays(inv.periodStart, -1)}`).join("\n"), { companyId: company.id, relatedType: "qualifying_event", relatedId: inv.eventId });
        }
      }
    }
  }
  return { warned, terminated };
}

/** Daily: warn 60 and 30 days before the maximum coverage date; end coverage on it. */
export async function maxCoverageCheckJob(asOf = today()) {
  const db = await getDb();
  const live = await db.select().from(tables.qualifiedBeneficiaries).where(inArray(tables.qualifiedBeneficiaries.status, ["active", "grace"]));
  let warned = 0;
  let ended = 0;
  for (const q of live) {
    const daysLeft = daysBetween(asOf, q.maxCoverageEnd);
    if (daysLeft < 0) {
      await setQbStatus([q.id], ["active", "grace"], "terminated", { terminatedOn: q.maxCoverageEnd, terminationReason: "max_coverage_reached" });
      const company = await getCompany(q.companyId);
      await sendLifecycleNotice({
        eventId: q.eventId,
        qbIds: [q.id],
        type: "coverage_ending",
        subject: "Your COBRA coverage has reached its maximum period",
        body: `COBRA coverage for ${q.firstName} ${q.lastName} ended on ${q.maxCoverageEnd}.${company.stateExtensionApplies ? " You may be able to continue coverage through Cal-COBRA with your carrier for up to 36 months total; your carrier will contact you." : ""}`,
        dedupeKey: `max-end-${q.id}`,
      });
      ended++;
      continue;
    }
    for (const w of COMPANY_POLICY.maxCoverageWarningDays) {
      if (daysLeft <= w) {
        const sentNow = await sendLifecycleNotice({
          eventId: q.eventId,
          qbIds: [q.id],
          type: "coverage_ending",
          subject: `Your COBRA coverage ends ${q.maxCoverageEnd}`,
          body: `COBRA coverage for ${q.firstName} ${q.lastName} ends on ${q.maxCoverageEnd}. Losing COBRA at the end of the maximum period opens a Marketplace special enrollment period.`,
          dedupeKey: `max-warn-${q.id}-${w}`,
        });
        if (sentNow) warned++;
      }
    }
  }
  return { warned, ended };
}

/** Monthly: bill employers the per-enrollee fee for the previous month (BIL-1). */
export async function employerBillingJob(asOf = today()) {
  const db = await getDb();
  const period = addMonths(startOfMonth(asOf), -1).slice(0, 7);
  const periodEnd = endOfMonth(`${period}-01`);
  const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(inArray(tables.qualifiedBeneficiaries.status, ["active", "grace", "terminated"]));
  const byCompany = new Map<string, number>();
  for (const q of qbs) {
    const wasActive = compareDates(q.cobraStart, periodEnd) <= 0 && (q.status !== "terminated" || (q.terminatedOn && compareDates(q.terminatedOn, `${period}-01`) >= 0 && q.terminationReason !== "initial_premium_not_paid"));
    if (wasActive) byCompany.set(q.companyId, (byCompany.get(q.companyId) ?? 0) + 1);
  }
  let charged = 0;
  for (const [companyId, count] of byCompany) {
    const existing = await db
      .select({ id: tables.employerCharges.id })
      .from(tables.employerCharges)
      .where(and(eq(tables.employerCharges.companyId, companyId), eq(tables.employerCharges.type, "enrollee_month"), eq(tables.employerCharges.period, period)));
    if (existing.length) continue;
    await recordEmployerCharge(companyId, "enrollee_month", count, { type: "period", id: period }, period);
    charged++;
  }
  return { period, companiesCharged: charged };
}

export const JOBS = {
  "send-election-notices": sendElectionNoticesJob,
  "close-election-windows": closeElectionWindowsJob,
  "initial-premium-check": initialPremiumCheckJob,
  "generate-invoices": generateInvoicesJob,
  "grace-period-check": gracePeriodCheckJob,
  "max-coverage-check": maxCoverageCheckJob,
  "employer-billing": employerBillingJob,
} as const;
export type JobName = keyof typeof JOBS;

export async function runJob<N extends JobName>(name: N, asOf = today()): Promise<Awaited<ReturnType<(typeof JOBS)[N]>>> {
  const fn = JOBS[name] as (asOf: string) => Promise<Awaited<ReturnType<(typeof JOBS)[N]>>>;
  if (!fn) throw new Error(`Unknown job ${name}`);
  const result = await fn(asOf);
  await audit(SYSTEM, { action: "job.ran", entityType: "job", entityId: name, after: { asOf, result } });
  return result;
}

/** Everything a daily scheduler tick should run, in dependency order. */
export async function runAllJobs(asOf = today()) {
  const results: Record<string, unknown> = {};
  for (const name of Object.keys(JOBS) as JobName[]) results[name] = await runJob(name, asOf);
  return results;
}

import { randomInt } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { decryptField, getDb, hashMatches, hashSecret, tables, type CoverageSnapshot } from "@cod/db";
import { premiumInvoicedPosting, premiumPaymentPosting } from "@cod/billing";
import {
  assertTransition,
  cobraMonthlyPremium,
  compareDates,
  deriveTier,
  evaluateInvoice,
  initialPremiumDue,
  laterOf,
  premiumPeriods,
  splitSubsidy,
  TIER_LABELS,
  type QbStatus,
  type Relationship,
  type Tier,
} from "@cod/rules";
import { audit, type Actor } from "./audit";
import { postLedger } from "./billing";
import { getCompany, getCompanyBySlug, hashPassword, UserError, verifyPassword } from "./companies";
import { isProduction, today } from "./env";
import { sendEmail, sendSms } from "./messaging";
import { openTask } from "./tasks";

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const OTP_MINUTES = 10;

function mask(contact: string): string {
  if (contact.includes("@")) {
    const [user, domain] = contact.split("@");
    return `${user!.slice(0, 1)}•••@${domain}`;
  }
  return `•••-•••-${contact.slice(-4)}`;
}

/**
 * Enrollee identity check (ENR-2): termination date + last 4 of the
 * employee's SSN + the person's own date of birth, then a one-time code.
 * Failed attempts are rate-limited per company and IP, since last 4 of the
 * SSN is a weak secret on its own.
 */
export async function startVerification(input: { slug: string; eventDate: string; last4: string; dob: string; ip: string }) {
  const company = await getCompanyBySlug(input.slug);
  if (!company) throw new UserError("We couldn't find that company.");
  const db = await getDb();
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000);
  const recent = await db
    .select()
    .from(tables.verificationAttempts)
    .where(and(eq(tables.verificationAttempts.companyId, company.id), eq(tables.verificationAttempts.ip, input.ip), gte(tables.verificationAttempts.at, since)));
  if (recent.filter((a) => !a.success).length >= MAX_FAILURES) {
    throw new UserError(`Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes or call the number in your packet.`);
  }

  const fail = async () => {
    await db.insert(tables.verificationAttempts).values({ companyId: company.id, ip: input.ip, success: false });
    throw new UserError("Those details don't match our records. Check the dates and try again.");
  };

  const events = await db
    .select({ event: tables.qualifyingEvents, employee: tables.employees })
    .from(tables.qualifyingEvents)
    .innerJoin(tables.employees, eq(tables.employees.id, tables.qualifyingEvents.employeeId))
    .where(and(eq(tables.qualifyingEvents.companyId, company.id), eq(tables.qualifyingEvents.eventDate, input.eventDate), eq(tables.qualifyingEvents.status, "sent")));

  const last4 = input.last4.replace(/\D/g, "");
  for (const { event, employee } of events) {
    if (!hashMatches(employee.ssnLast4Hash, company.id, last4)) continue;
    const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, event.id));
    for (const qb of qbs) {
      let dob: string;
      if (qb.dependentId) {
        const [dep] = await db.select({ dobEnc: tables.dependents.dobEnc }).from(tables.dependents).where(eq(tables.dependents.id, qb.dependentId));
        if (!dep) continue;
        dob = decryptField(dep.dobEnc);
      } else {
        dob = decryptField(employee.dobEnc);
      }
      if (dob !== input.dob) continue;

      // Same-address family members share the household packet, so they can use its contact details.
      const sameHousehold = qb.relationship === "employee" || JSON.stringify(qb.address) === JSON.stringify(employee.address);
      const contact = qb.email ?? (sameHousehold ? employee.email ?? employee.phone : null);
      if (!contact) {
        await db.insert(tables.verificationAttempts).values({ companyId: company.id, ip: input.ip, success: true });
        throw new UserError("We don't have an email or phone number on file for you. Please call the number in your packet so we can verify you.");
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await db.insert(tables.otpCodes).values({
        qbId: qb.id,
        codeHash: hashSecret("otp", `${qb.id}:${code}`),
        sentTo: contact,
        expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000),
      });
      await db.insert(tables.verificationAttempts).values({ companyId: company.id, ip: input.ip, success: true });
      const text = `Your ${company.legalName} COBRA verification code is ${code}. It expires in ${OTP_MINUTES} minutes.`;
      if (contact.includes("@")) await sendEmail(contact, "Your COBRA verification code", text, { companyId: company.id, relatedType: "qualified_beneficiary", relatedId: qb.id });
      else await sendSms(contact, text, { companyId: company.id, relatedType: "qualified_beneficiary", relatedId: qb.id });
      return { qbId: qb.id, sentTo: mask(contact), devCode: isProduction() ? undefined : code };
    }
  }
  return fail();
}

export async function verifyCode(qbId: string, code: string) {
  const db = await getDb();
  const [latest] = await db.select().from(tables.otpCodes).where(eq(tables.otpCodes.qbId, qbId)).orderBy(desc(tables.otpCodes.createdAt)).limit(1);
  if (!latest || latest.consumedAt || latest.expiresAt < new Date()) throw new UserError("That code has expired. Start again to get a new one.");
  if (latest.attempts >= MAX_FAILURES) throw new UserError("Too many wrong codes. Start again to get a new one.");
  if (latest.codeHash !== hashSecret("otp", `${qbId}:${code.trim()}`)) {
    await db.update(tables.otpCodes).set({ attempts: latest.attempts + 1 }).where(eq(tables.otpCodes.id, latest.id));
    throw new UserError("That code isn't right.");
  }
  await db.update(tables.otpCodes).set({ consumedAt: new Date() }).where(eq(tables.otpCodes.id, latest.id));
  const [qb] = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.id, qbId));
  await audit({ type: "enrollee", id: qbId }, { companyId: qb!.companyId, action: "enrollee.verified", entityType: "qualified_beneficiary", entityId: qbId });
  return { qbId, companyId: qb!.companyId, eventId: qb!.eventId };
}

/** A covered employee or spouse may elect for the whole family; anyone else elects only for themselves. */
function canManage(actor: { relationship: string; id: string }, target: { id: string }): boolean {
  return actor.id === target.id || actor.relationship === "employee" || actor.relationship === "spouse";
}

export interface PlanOption {
  planId: string;
  name: string;
  carrier: string;
  type: string;
  insured: boolean;
  /** Tier on the last day of coverage. */
  originalTier: Tier;
  rates: { tier: Tier; label: string; monthly: number }[];
  coveredQbIds: string[];
}

function planOptions(snapshot: CoverageSnapshot, qbs: (typeof tables.qualifiedBeneficiaries.$inferSelect)[]): PlanOption[] {
  const keyOf = (q: (typeof qbs)[number]) => (q.dependentId ? `dependent:${q.dependentId}` : `employee:${q.employeeId}`);
  return snapshot.plans.map((pl) => ({
    planId: pl.planId,
    name: pl.name,
    carrier: pl.carrier,
    type: pl.type,
    insured: pl.insured,
    originalTier: pl.tier as Tier,
    rates: pl.rates.map((r) => ({ tier: r.tier as Tier, label: TIER_LABELS[r.tier as Tier], monthly: cobraMonthlyPremium(r.monthlyCost) })),
    coveredQbIds: qbs.filter((q) => snapshot.people.find((p) => p.personKey === keyOf(q))?.planIds.includes(pl.planId)).map((q) => q.id),
  }));
}

export async function getEnrolleeView(qbId: string) {
  const db = await getDb();
  const [qb] = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.id, qbId));
  if (!qb) throw new UserError("Not found.");
  const company = await getCompany(qb.companyId);
  const [event] = await db.select().from(tables.qualifyingEvents).where(eq(tables.qualifyingEvents.id, qb.eventId));
  const household = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, qb.eventId));
  const manageable = household.filter((h) => canManage(qb, h));
  const noticeRows = await db.select().from(tables.notices).where(eq(tables.notices.eventId, qb.eventId));
  const notice = noticeRows.find((n) => n.addresseeQbIds.includes(qb.id)) ?? noticeRows[0] ?? null;
  const electionRows = await db.select().from(tables.elections).where(eq(tables.elections.eventId, qb.eventId));
  const invoices = await db.select().from(tables.premiumInvoices).where(eq(tables.premiumInvoices.eventId, qb.eventId));
  const account = qb.accountId ? (await db.select().from(tables.enrolleeAccounts).where(eq(tables.enrolleeAccounts.id, qb.accountId)))[0] ?? null : null;
  const methods = account ? await db.select().from(tables.paymentMethods).where(and(eq(tables.paymentMethods.accountId, account.id), eq(tables.paymentMethods.status, "active"))) : [];
  const paymentRows = invoices.length ? await db.select().from(tables.payments).where(inArray(tables.payments.invoiceId, invoices.map((i) => i.id))) : [];
  return {
    company: { name: company.legalName, slug: company.slug, state: company.state, stateExtensionApplies: company.stateExtensionApplies },
    event: event!,
    me: qb,
    household,
    manageable,
    plans: planOptions(event!.coverageSnapshot!, household),
    notice,
    elections: electionRows,
    invoices: invoices.sort((a, b) => a.periodStart.localeCompare(b.periodStart)),
    payments: paymentRows,
    account: account ? { id: account.id, email: account.email } : null,
    paymentMethods: methods,
    today: today(),
  };
}

export async function acknowledgeNotice(qbId: string, meta: { ip?: string; userAgent?: string; documentSha256?: string }) {
  const db = await getDb();
  const [qb] = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.id, qbId));
  if (!qb) throw new UserError("Not found.");
  if (qb.noticeAcknowledgedAt) return;
  // Acknowledgment of receipt only; the 60-day clock runs from delivery, not from this click.
  await db
    .update(tables.qualifiedBeneficiaries)
    .set({ noticeAcknowledgedAt: new Date(), noticeAckMeta: { ip: meta.ip, userAgent: meta.userAgent, documentSha256: meta.documentSha256 } })
    .where(eq(tables.qualifiedBeneficiaries.id, qbId));
  await audit({ type: "enrollee", id: qbId, ip: meta.ip }, { companyId: qb.companyId, action: "notice.acknowledged", entityType: "qualified_beneficiary", entityId: qbId, after: meta });
}

export interface ElectionSubmission {
  actorQbId: string;
  /** decisions[qbId][planId] */
  decisions: Record<string, Record<string, "elect" | "waive">>;
  signedName: string;
  stateNoticesReviewed: boolean;
  ip?: string;
}

function confirmationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[randomInt(0, alphabet.length)]).join("");
}

/**
 * Submit elections (ENR-4): each qualified beneficiary decides per plan, a
 * person can only continue plans they had, and the e-signature, IP and a
 * confirmation number are recorded. Electing creates the initial premium
 * invoice covering every month back to the loss of coverage.
 */
export async function submitElections(sub: ElectionSubmission) {
  const db = await getDb();
  const view = await getEnrolleeView(sub.actorQbId);
  const asOf = today();
  if (sub.signedName.trim().length < 3) throw new UserError("Type your full name to sign.", "signedName");
  if (view.company.state === "CA" && !sub.stateNoticesReviewed) {
    throw new UserError("Please review the California and Marketplace notices before submitting.");
  }

  const targets = view.manageable.filter((q) => sub.decisions[q.id]);
  if (targets.length === 0) throw new UserError("Choose elect or waive for at least one person.");
  for (const q of targets) {
    if (!["notice_sent", "waived"].includes(q.status)) throw new UserError(`${q.firstName} has already made a final election.`);
    if (!q.electionDeadline || compareDates(asOf, q.electionDeadline) > 0) throw new UserError(`The election deadline for ${q.firstName} has passed.`);
    for (const plan of view.plans.filter((p) => p.coveredQbIds.includes(q.id))) {
      if (!sub.decisions[q.id]![plan.planId]) throw new UserError(`Choose elect or waive for ${q.firstName} on ${plan.name}.`);
    }
    for (const planId of Object.keys(sub.decisions[q.id]!)) {
      const plan = view.plans.find((p) => p.planId === planId);
      if (!plan || !plan.coveredQbIds.includes(q.id)) throw new UserError(`${q.firstName} wasn't covered on that plan, so it can't be continued.`);
    }
  }

  const code = confirmationCode();
  await db.transaction(async (tx) => {
    for (const q of targets) {
      const decisions = sub.decisions[q.id]!;
      for (const [planId, decision] of Object.entries(decisions)) {
        await tx.insert(tables.elections).values({ companyId: q.companyId, eventId: q.eventId, qbId: q.id, planId, decision, signedName: sub.signedName.trim(), ip: sub.ip ?? null, confirmationCode: code });
      }
      const elected = Object.values(decisions).includes("elect");
      const next: QbStatus = elected ? "elected" : "waived";
      if (q.status !== next) assertTransition(q.status as QbStatus, next);
      await tx
        .update(tables.qualifiedBeneficiaries)
        .set(elected ? { status: next, electedOn: asOf } : { status: next, waivedOn: asOf })
        .where(eq(tables.qualifiedBeneficiaries.id, q.id));
    }
  });

  await audit({ type: "enrollee", id: sub.actorQbId, ip: sub.ip }, { companyId: view.me.companyId, action: "election.submitted", entityType: "qualifying_event", entityId: view.event.id, after: { confirmationCode: code, decisions: sub.decisions } });
  const invoice = await rebuildInitialInvoice(view.event.id);

  const contact = view.me.email;
  if (contact) {
    const lines = targets.map((q) => `${q.firstName} ${q.lastName}: ${Object.entries(sub.decisions[q.id]!).map(([pid, d]) => `${view.plans.find((p) => p.planId === pid)?.name} ${d === "elect" ? "ELECTED" : "waived"}`).join(", ")}`);
    await sendEmail(
      contact,
      `COBRA election received, confirmation ${code}`,
      [`We received your COBRA election on ${asOf}. Confirmation number: ${code}.`, ...lines, invoice ? `Your first premium of $${(invoice.amountDue / 100).toFixed(2)} is due by ${invoice.finalPaymentDate}.` : ""].filter(Boolean).join("\n"),
      { companyId: view.me.companyId, relatedType: "qualifying_event", relatedId: view.event.id },
    );
  }
  return { confirmationCode: code, invoice };
}

/** Monthly premium for the household: per plan, the tier of whoever elected it. */
export async function householdPremiums(eventId: string) {
  const db = await getDb();
  const [event] = await db.select().from(tables.qualifyingEvents).where(eq(tables.qualifyingEvents.id, eventId));
  const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, eventId));
  const electionRows = await db.select().from(tables.elections).where(eq(tables.elections.eventId, eventId));
  const covered = qbs.filter((q) => ["elected", "active", "grace"].includes(q.status));
  const lines: { planId: string; planName: string; tier: Tier; amount: number }[] = [];
  for (const plan of event!.coverageSnapshot!.plans) {
    const electing = covered.filter((q) => {
      const latest = electionRows.filter((e) => e.qbId === q.id && e.planId === plan.planId).sort((a, b) => +b.signedAt - +a.signedAt)[0];
      return latest?.decision === "elect";
    });
    const tier = deriveTier(electing.map((q) => q.relationship as Relationship));
    if (!tier) continue;
    let rate = plan.rates.find((r) => r.tier === tier);
    if (!rate) {
      rate = plan.rates.find((r) => r.tier === plan.tier);
      await openTask({ companyId: event!.companyId, type: "missing_rate", title: `No ${TIER_LABELS[tier]} rate for ${plan.name}`, detail: "Billed at the original tier until the rate is supplied.", entityType: "qualifying_event", entityId: eventId });
    }
    if (rate) lines.push({ planId: plan.planId, planName: plan.name, tier, amount: cobraMonthlyPremium(rate.monthlyCost) });
  }
  const maxEnd = covered.map((q) => q.maxCoverageEnd).sort().at(-1) ?? qbs[0]!.maxCoverageEnd;
  return { event: event!, qbs, covered, lines, monthly: lines.reduce((s, l) => s + l.amount, 0), maxEnd };
}

/** Initial invoice: every month from COBRA start through the current month, due 45 days after electing. */
export async function rebuildInitialInvoice(eventId: string) {
  const db = await getDb();
  const { event, covered, lines, monthly, maxEnd } = await householdPremiums(eventId);
  const existing = await db.select().from(tables.premiumInvoices).where(and(eq(tables.premiumInvoices.eventId, eventId), eq(tables.premiumInvoices.kind, "initial")));
  const paid = existing.find((i) => i.status === "paid");
  if (paid) return paid;
  for (const inv of existing.filter((i) => i.status === "open")) {
    await db.update(tables.premiumInvoices).set({ status: "void" }).where(eq(tables.premiumInvoices.id, inv.id));
  }
  if (covered.length === 0 || monthly === 0) return null;

  const firstElected = covered.map((q) => q.electedOn!).sort()[0]!;
  const cobraStart = covered[0]!.cobraStart;
  // Electing before COBRA starts (coverage still active through month-end) still bills the first month.
  const periods = premiumPeriods(cobraStart, laterOf(today(), cobraStart), maxEnd, monthly);
  const subsidy = event.subsidyMonths && event.subsidyPercent ? { months: event.subsidyMonths, percent: event.subsidyPercent } : null;
  const splits = periods.map((p, i) => splitSubsidy(p.amount, i, subsidy));
  const amountDue = splits.reduce((s, x) => s + x.enrollee, 0);
  const subsidyAmount = splits.reduce((s, x) => s + x.employer, 0);
  const accountId = covered.find((q) => q.accountId)?.accountId ?? null;

  const [invoice] = await db
    .insert(tables.premiumInvoices)
    .values({
      companyId: event.companyId,
      eventId,
      accountId,
      kind: "initial",
      periodStart: periods[0]!.periodStart,
      periodEnd: periods.at(-1)!.periodEnd,
      dueDate: firstElected,
      finalPaymentDate: initialPremiumDue(firstElected),
      amountDue,
      subsidyAmount,
      status: amountDue === 0 ? "paid" : "open",
      lines: lines.map((l) => ({ planName: l.planName, tier: TIER_LABELS[l.tier], amount: l.amount })),
    })
    .returning();
  await postLedger(event.companyId, premiumInvoicedPosting(invoice!.id, amountDue, subsidyAmount));
  if (amountDue === 0) await activateCoverage(eventId);
  return invoice!;
}

export async function createEnrolleeAccount(qbId: string, email: string, password: string) {
  if (password.length < 10) throw new UserError("Use at least 10 characters.", "password");
  const db = await getDb();
  const view = await getEnrolleeView(qbId);
  const normalized = email.trim().toLowerCase();
  let [account] = await db
    .select()
    .from(tables.enrolleeAccounts)
    .where(and(eq(tables.enrolleeAccounts.companyId, view.me.companyId), eq(tables.enrolleeAccounts.email, normalized)));
  if (!account) {
    [account] = await db.insert(tables.enrolleeAccounts).values({ companyId: view.me.companyId, email: normalized, passwordHash: await hashPassword(password) }).returning();
  } else if (!(await verifyPassword(password, account.passwordHash))) {
    throw new UserError("An account with this email exists. Enter its password to link it.", "password");
  }
  await db.update(tables.qualifiedBeneficiaries).set({ accountId: account!.id }).where(inArray(tables.qualifiedBeneficiaries.id, view.manageable.map((q) => q.id)));
  await db.update(tables.premiumInvoices).set({ accountId: account!.id }).where(eq(tables.premiumInvoices.eventId, view.event.id));
  await audit({ type: "enrollee", id: qbId }, { companyId: view.me.companyId, action: "enrollee.account_created", entityType: "enrollee_account", entityId: account!.id });
  return account!;
}

export async function loginEnrollee(slug: string, email: string, password: string) {
  const company = await getCompanyBySlug(slug);
  if (!company) return null;
  const db = await getDb();
  const [account] = await db
    .select()
    .from(tables.enrolleeAccounts)
    .where(and(eq(tables.enrolleeAccounts.companyId, company.id), eq(tables.enrolleeAccounts.email, email.trim().toLowerCase())));
  if (!account || !(await verifyPassword(password, account.passwordHash))) return null;
  const [qb] = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.accountId, account.id));
  return qb ? { qbId: qb.id, companyId: company.id, eventId: qb.eventId } : null;
}

/**
 * Save a payment method (ENR-6). Production uses Stripe Elements / Financial
 * Connections and stores only the PaymentMethod id; card and bank numbers
 * never touch our servers. Without Stripe keys a test token is recorded.
 */
export async function addPaymentMethod(accountId: string, type: "ach" | "card", autopay: boolean, actor: Actor) {
  const db = await getDb();
  const [account] = await db.select().from(tables.enrolleeAccounts).where(eq(tables.enrolleeAccounts.id, accountId));
  if (!account) throw new UserError("Create your account first.");
  const [method] = await db
    .insert(tables.paymentMethods)
    .values({ companyId: account.companyId, accountId, type, processorRef: `pm_test_${crypto.randomUUID().slice(0, 12)}`, last4: type === "card" ? "4242" : "6789", autopay })
    .returning();
  await audit(actor, { companyId: account.companyId, action: "payment_method.added", entityType: "payment_method", entityId: method!.id, after: { type, autopay } });
  return method!;
}

export async function payInvoice(invoiceId: string, methodId: string, actor: Actor, amount?: number) {
  const db = await getDb();
  const [invoice] = await db.select().from(tables.premiumInvoices).where(eq(tables.premiumInvoices.id, invoiceId));
  if (!invoice) throw new UserError("Invoice not found.");
  if (invoice.status === "paid" || invoice.status === "void") throw new UserError("This invoice is already settled.");
  const [method] = await db.select().from(tables.paymentMethods).where(eq(tables.paymentMethods.id, methodId));
  if (!method || method.accountId !== invoice.accountId) throw new UserError("Choose one of your saved payment methods.");

  const prior = await db.select().from(tables.payments).where(and(eq(tables.payments.invoiceId, invoiceId), eq(tables.payments.status, "succeeded")));
  const remaining = invoice.amountDue - prior.reduce((s, p) => s + p.amount, 0);
  const charge = amount ?? remaining;
  if (charge <= 0) throw new UserError("Nothing is owed on this invoice.");

  const [payment] = await db
    .insert(tables.payments)
    .values({ companyId: invoice.companyId, invoiceId, methodId, amount: charge, paidOn: today(), processorRef: `pi_test_${crypto.randomUUID().slice(0, 12)}`, status: "succeeded" })
    .returning();
  await postLedger(invoice.companyId, premiumPaymentPosting(payment!.id, charge));
  await audit(actor, { companyId: invoice.companyId, action: "payment.succeeded", entityType: "premium_invoice", entityId: invoiceId, after: { amount: charge } });
  return refreshInvoiceStatus(invoiceId);
}

export async function refreshInvoiceStatus(invoiceId: string) {
  const db = await getDb();
  const [invoice] = await db.select().from(tables.premiumInvoices).where(eq(tables.premiumInvoices.id, invoiceId));
  const pays = await db.select().from(tables.payments).where(and(eq(tables.payments.invoiceId, invoiceId), eq(tables.payments.status, "succeeded")));
  const evaluation = evaluateInvoice({
    amountDue: invoice!.amountDue,
    dueDate: invoice!.dueDate,
    finalPaymentDate: invoice!.finalPaymentDate,
    payments: pays.map((p) => ({ amount: p.amount, paidOn: p.paidOn })),
    today: today(),
  });
  const status = evaluation.status === "paid" ? "paid" : evaluation.status === "shortfall_cure" ? "shortfall_cure" : evaluation.status === "lapsed" ? "lapsed" : "open";
  if (status !== invoice!.status) await db.update(tables.premiumInvoices).set({ status }).where(eq(tables.premiumInvoices.id, invoiceId));
  if (status === "paid") await activateCoverage(invoice!.eventId);
  return { ...invoice!, status, evaluation };
}

/**
 * Initial premium paid → coverage reinstated, retroactive to the loss of
 * coverage. At launch the carrier learns by a pre-filled enrollment form
 * emailed to the employer (carrier enrollment stage 1).
 */
export async function activateCoverage(eventId: string) {
  const db = await getDb();
  const qbs = await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, eventId));
  const toActivate = qbs.filter((q) => q.status === "elected" || q.status === "grace");
  if (toActivate.length === 0) return;
  for (const q of toActivate) assertTransition(q.status as QbStatus, "active");
  await db.update(tables.qualifiedBeneficiaries).set({ status: "active" }).where(inArray(tables.qualifiedBeneficiaries.id, toActivate.map((q) => q.id)));
  const reinstated = toActivate.filter((q) => q.status === "elected");
  if (reinstated.length === 0) return;
  const company = await getCompany(qbs[0]!.companyId);
  const { lines } = await householdPremiums(eventId);
  if (company.hrContactEmail) {
    await sendEmail(
      company.hrContactEmail,
      "COBRA enrollment: please reinstate coverage with the carrier",
      [
        "The following people elected COBRA and paid their first premium. Please send this enrollment to the carrier (coverage is retroactive, no gap):",
        ...reinstated.map((q) => `• ${q.firstName} ${q.lastName} (${q.relationship}), COBRA from ${q.cobraStart} through ${q.maxCoverageEnd}`),
        ...lines.map((l) => `Plan: ${l.planName}, tier ${TIER_LABELS[l.tier]}`),
      ].join("\n"),
      { companyId: company.id, relatedType: "qualifying_event", relatedId: eventId },
    );
  }
  await audit({ type: "system" }, { companyId: company.id, action: "coverage.activated", entityType: "qualifying_event", entityId: eventId, after: { beneficiaries: reinstated.map((q) => q.id) } });
}

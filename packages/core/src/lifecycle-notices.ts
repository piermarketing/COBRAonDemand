import { eq } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { TEMPLATE_VERSIONS, type TemplateId } from "@cod/notices";
import { getCompany } from "./companies";
import { enrolleeUrl } from "./env";
import { sendEmail, sendPrintMail } from "./messaging";

/**
 * Notices after the election packet: premium due, grace warnings, shortfall
 * cure, early termination and coverage ending (NOT-1). Delivered by email
 * with a link, and mailed when there is no email on file.
 */
export async function sendLifecycleNotice(opts: {
  eventId: string;
  qbIds: string[];
  type: Extract<TemplateId, "premium_due" | "shortfall_cure" | "grace_warning" | "early_termination" | "coverage_ending" | "general_notice">;
  subject: string;
  body: string;
  /** Dedupe key: the same key is never sent twice for an event. */
  dedupeKey: string;
}) {
  const db = await getDb();
  const existing = await db.select({ id: tables.messages.id }).from(tables.messages).where(eq(tables.messages.relatedId, `${opts.eventId}:${opts.dedupeKey}`));
  if (existing.length) return false;

  const [event] = await db.select().from(tables.qualifyingEvents).where(eq(tables.qualifyingEvents.id, opts.eventId));
  const company = await getCompany(event!.companyId);
  const qbs = (await db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, opts.eventId))).filter((q) => opts.qbIds.includes(q.id));
  const addressee = qbs.find((q) => q.relationship === "employee") ?? qbs[0];
  if (!addressee) return false;

  const body = `${opts.body}\n\nManage your COBRA account: ${enrolleeUrl(company.slug)}`;
  const related = { companyId: company.id, relatedType: "lifecycle_notice", relatedId: `${opts.eventId}:${opts.dedupeKey}` };
  let channel: "email" | "mail" | "email_and_mail" = "email";
  if (addressee.email) await sendEmail(addressee.email, opts.subject, body, related);
  if (!addressee.email || opts.type === "early_termination") {
    channel = addressee.email ? "email_and_mail" : "mail";
    const a = addressee.address;
    await sendPrintMail(`${addressee.firstName} ${addressee.lastName}`, [a.line1, `${a.city}, ${a.state} ${a.postalCode}`], opts.subject, related);
  }
  await db.insert(tables.notices).values({
    companyId: company.id,
    eventId: opts.eventId,
    employeeId: event!.employeeId,
    addresseeQbIds: qbs.map((q) => q.id),
    addresseeName: `${addressee.firstName} ${addressee.lastName}`,
    addresseeEmail: addressee.email,
    type: opts.type,
    templateVersions: { [opts.type]: TEMPLATE_VERSIONS[opts.type] },
    packet: { subject: opts.subject, body },
    sentAt: new Date(),
    channel,
    status: "sent",
  });
  return true;
}

import { and, eq, inArray, isNull } from "drizzle-orm";
import { documentStore, getDb, tables, type Address } from "@cod/db";
import { buildPacket, formatDate, packetTemplateVersions, renderPacketPdf, sha256Hex, type NoticePlan, type PacketContext } from "@cod/notices";
import {
  addMonths,
  assertTransition,
  cobraMonthlyPremium,
  deriveTier,
  electionWindowEnd,
  FEDERAL,
  TIER_LABELS,
  type QbStatus,
  type Relationship,
  type Tier,
} from "@cod/rules";
import { audit, SYSTEM, type Actor } from "./audit";
import { recordEmployerCharge } from "./billing";
import { getCompany } from "./companies";
import { ADMINISTRATOR, enrolleeUrl, today } from "./env";
import { sendEmail, sendPrintMail, sendSms } from "./messaging";

export const E_DELIVERY_DISCLOSURE_VERSION = "edelivery-2026.10-draft";

function addressLines(a: Address): string[] {
  return [a.line1, ...(a.line2 ? [a.line2] : []), `${a.city}, ${a.state} ${a.postalCode}`];
}

function addressKey(a: Address): string {
  return [a.line1, a.line2 ?? "", a.city, a.state, a.postalCode].join("|").toLowerCase().replace(/\s+/g, " ").trim();
}

async function hasActiveConsent(employeeId: string, email: string | null): Promise<boolean> {
  if (!email) return false;
  const db = await getDb();
  const rows = await db
    .select()
    .from(tables.eDeliveryConsents)
    .where(and(eq(tables.eDeliveryConsents.employeeId, employeeId), isNull(tables.eDeliveryConsents.withdrawnAt)));
  return rows.some((r) => r.email.toLowerCase() === email.toLowerCase());
}

async function storeDocument(companyId: string, kind: string, bytes: Uint8Array) {
  const db = await getDb();
  const sha256 = sha256Hex(bytes);
  const storagePath = `${companyId}/${kind}/${sha256}.pdf`;
  await documentStore().put(storagePath, bytes);
  const [doc] = await db
    .insert(tables.documents)
    .values({
      companyId,
      kind,
      storagePath,
      sha256,
      sizeBytes: bytes.byteLength,
      mime: "application/pdf",
      // ERISA 6+ years; CA Ins. Code 1759 term + 5. Keep 7 years from creation by default.
      retentionUntil: addMonths(today(), 12 * (FEDERAL.recordRetentionYears + 1)),
    })
    .returning();
  return doc!;
}

/**
 * Generate and deliver election packets for an event (NOT-3 … NOT-7, NOT-13,
 * ELE-3, ELE-4). One packet per address; electronic delivery only with
 * affirmative consent on file, otherwise the packet is mailed automatically and
 * the employer is billed the manual administration fee. The per-packet fee is
 * charged when the packet is sent (TRG-14).
 */
export async function sendEventPackets(eventId: string, actor: Actor = SYSTEM) {
  const db = await getDb();
  const [event] = await db.select().from(tables.qualifyingEvents).where(eq(tables.qualifyingEvents.id, eventId));
  if (!event || !event.coverageSnapshot) return { sent: 0 };
  if (!["ready", "pending_confirmation", "scheduled"].includes(event.status)) return { sent: 0 };
  const company = await getCompany(event.companyId);
  const qbs = await db
    .select()
    .from(tables.qualifiedBeneficiaries)
    .where(and(eq(tables.qualifiedBeneficiaries.eventId, event.id), eq(tables.qualifiedBeneficiaries.status, "pending_notice")));
  if (qbs.length === 0) return { sent: 0 };

  const [employee] = await db.select().from(tables.employees).where(eq(tables.employees.id, event.employeeId));
  const snapshot = event.coverageSnapshot;
  const noticeDate = today();
  const electionDeadline = electionWindowEnd(noticeDate, event.lossOfCoverageDate);
  const url = enrolleeUrl(company.slug);

  const groups = new Map<string, typeof qbs>();
  for (const qb of qbs) {
    const k = addressKey(qb.address);
    groups.set(k, [...(groups.get(k) ?? []), qb]);
  }

  let sent = 0;
  for (const [key, group] of groups) {
    const addressee = group.find((q) => q.relationship === "employee") ?? group.find((q) => q.relationship === "spouse") ?? group[0]!;
    const memberKeys = new Set(group.map((q) => (q.dependentId ? `dependent:${q.dependentId}` : `employee:${q.employeeId}`)));
    const people = snapshot.people.filter((p) => memberKeys.has(p.personKey));

    const plans: NoticePlan[] = snapshot.plans
      .filter((pl) => people.some((p) => p.planIds.includes(pl.planId)))
      .map((pl) => {
        const rels = people.filter((p) => p.planIds.includes(pl.planId)).map((p) => p.relationship as Relationship);
        const tier = (deriveTier(rels) ?? pl.tier) as Tier;
        const rate = pl.rates.find((r) => r.tier === tier) ?? pl.rates.find((r) => r.tier === pl.tier);
        return {
          name: pl.name,
          carrier: pl.carrier,
          type: pl.type,
          currentTier: TIER_LABELS[tier],
          monthlyPremium: rate ? cobraMonthlyPremium(rate.monthlyCost) : 0,
          rates: pl.rates.map((r) => ({ tier: TIER_LABELS[r.tier as Tier] ?? r.tier, monthly: cobraMonthlyPremium(r.monthlyCost) })),
          insured: pl.insured,
        };
      });

    const others = [...groups.entries()].filter(([k]) => k !== key).flatMap(([, g]) => g.map((q) => `${q.firstName} ${q.lastName}`));
    const ctx: PacketContext = {
      noticeDate,
      language: "en",
      employer: {
        name: company.legalName,
        addressLines: [company.addressLine1 ?? "", `${company.city ?? ""}, ${company.state} ${company.postalCode ?? ""}`].filter((l) => l.trim() && l.trim() !== ","),
        phone: company.hrContactPhone ?? company.phone ?? undefined,
        state: company.state,
        hrContact: company.hrContactName ?? undefined,
      },
      administrator: ADMINISTRATOR,
      planName: company.planName ?? `${company.legalName} Group Health Plan`,
      event: { type: event.type as PacketContext["event"]["type"], eventDate: event.eventDate, lossOfCoverageDate: event.lossOfCoverageDate, cobraStart: group[0]!.cobraStart },
      addressee: { name: `${addressee.firstName} ${addressee.lastName}`, addressLines: addressLines(addressee.address), email: addressee.email ?? undefined },
      beneficiaries: group.map((q) => ({ name: `${q.firstName} ${q.lastName}`, relationship: q.relationship, maxCoverageEnd: q.maxCoverageEnd })),
      plans,
      electionDeadline,
      initialPremiumDays: FEDERAL.initialPremiumDays,
      graceDays: FEDERAL.graceDays,
      enrolleeUrl: url,
      unavailableReason: event.grossMisconduct ? "The employer reported that employment ended because of gross misconduct, which removes COBRA rights." : undefined,
      stateExtensionApplies: company.stateExtensionApplies,
      subsidy: event.subsidyMonths && event.subsidyPercent ? { months: event.subsidyMonths, percent: event.subsidyPercent } : undefined,
      separateNoticeTo: others.length ? others : undefined,
    };

    const packet = buildPacket(ctx);
    const pdf = await renderPacketPdf(packet, { administratorName: ADMINISTRATOR.name });
    const doc = await storeDocument(company.id, packet.kind === "election" ? "election_packet" : "unavailability_notice", pdf);

    const email = addressee.email;
    const consented = addressee.relationship === "employee" && employee ? await hasActiveConsent(employee.id, email) : false;
    const channel = consented ? "email" : email ? "email_and_mail" : "mail";

    const [notice] = await db
      .insert(tables.notices)
      .values({
        companyId: company.id,
        eventId: event.id,
        employeeId: event.employeeId,
        addresseeQbIds: group.map((q) => q.id),
        addresseeName: ctx.addressee.name,
        addresseeEmail: email,
        type: packet.kind === "election" ? "election_packet" : "unavailability",
        templateVersions: packetTemplateVersions(packet),
        packet,
        documentId: doc.id,
        deadline: event.electionNoticeDue,
        sentAt: new Date(),
        channel,
        status: "sent",
      })
      .returning();

    const related = { companyId: company.id, relatedType: "notice", relatedId: notice!.id };
    if (email) {
      // Significance line: what the notice is and when the deadline is (DOL safe harbor).
      const subject =
        packet.kind === "election"
          ? `Action required: your COBRA health coverage election, deadline ${formatDate(electionDeadline)}`
          : "Important notice about your COBRA continuation coverage";
      await sendEmail(
        email,
        subject,
        [
          `Hello ${addressee.firstName},`,
          packet.kind === "election"
            ? `Your health coverage with ${company.legalName} ends on ${formatDate(event.lastCoveredDay)}. You can continue it through COBRA. Your election deadline is ${formatDate(electionDeadline)}.`
            : "We have an important notice about your COBRA rights.",
          `Read your notice and elect online: ${url}`,
          "You can ask for a free paper copy at any time from the portal or by replying to this email.",
        ].join("\n\n"),
        related,
      );
    }
    const phone = addressee.relationship === "employee" ? employee?.phone : null;
    if (phone && packet.kind === "election") {
      await sendSms(phone, `${company.legalName} COBRA: your election deadline is ${formatDate(electionDeadline)}. Details: ${url}`, related);
    }
    if (channel !== "email") {
      const tracking = await sendPrintMail(ctx.addressee.name, ctx.addressee.addressLines, `${packet.kind === "election" ? "COBRA election packet" : "COBRA notice"} (${packet.documents.length} documents)`, related);
      await db.update(tables.notices).set({ mailTrackingId: tracking }).where(eq(tables.notices.id, notice!.id));
      await recordEmployerCharge(company.id, "manual_admin", 1, { type: "notice", id: notice!.id });
    }

    const nextStatus: QbStatus = packet.kind === "election" ? "notice_sent" : "ineligible";
    for (const q of group) assertTransition(q.status as QbStatus, nextStatus);
    await db
      .update(tables.qualifiedBeneficiaries)
      .set({ status: nextStatus, noticeSentOn: noticeDate, electionDeadline: packet.kind === "election" ? electionDeadline : null })
      .where(inArray(tables.qualifiedBeneficiaries.id, group.map((q) => q.id)));

    if (packet.kind === "election") await recordEmployerCharge(company.id, "packet", 1, { type: "notice", id: notice!.id });
    await audit(actor, {
      companyId: company.id,
      action: "notice.sent",
      entityType: "notice",
      entityId: notice!.id,
      after: { kind: packet.kind, channel, beneficiaries: group.length, sha256: doc.sha256, electionDeadline },
    });
    sent++;
  }

  await db.update(tables.qualifyingEvents).set({ status: "sent" }).where(eq(tables.qualifyingEvents.id, event.id));
  if (company.hrContactEmail && employee) {
    await sendEmail(
      company.hrContactEmail,
      `COBRA packet sent for ${employee.firstName} ${employee.lastName}`,
      `${sent} packet(s) sent on ${formatDate(noticeDate)}. Election deadline: ${formatDate(electionDeadline)}.`,
      { companyId: company.id, relatedType: "qualifying_event", relatedId: event.id },
    );
  }
  return { sent };
}

export async function getNoticeDocument(companyId: string, noticeId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ notice: tables.notices, document: tables.documents })
    .from(tables.notices)
    .innerJoin(tables.documents, eq(tables.documents.id, tables.notices.documentId))
    .where(and(eq(tables.notices.id, noticeId), eq(tables.notices.companyId, companyId)));
  if (!row) return null;
  const bytes = await documentStore().get(row.document.storagePath);
  if (sha256Hex(bytes) !== row.document.sha256) throw new Error("Stored document failed its integrity check");
  return { ...row, bytes };
}

export async function listNoticesForEvent(eventId: string) {
  const db = await getDb();
  return db.select().from(tables.notices).where(eq(tables.notices.eventId, eventId));
}

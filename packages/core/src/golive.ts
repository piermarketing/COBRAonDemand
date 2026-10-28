import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { audit, type Actor } from "./audit";
import { getCompany, setModuleStatus, UserError } from "./companies";
import { appBaseUrl } from "./env";
import { sendEmail } from "./messaging";
import { E_DELIVERY_DISCLOSURE_VERSION } from "./notices";
import { setupOverview } from "./setup";

function consentSecret(): string {
  const s = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-session-secret-change-me");
  if (!s) throw new Error("SESSION_SECRET is required in production");
  return s;
}

export function consentToken(employeeId: string): string {
  const sig = createHmac("sha256", consentSecret()).update(`consent:${employeeId}`).digest("base64url").slice(0, 32);
  return `${employeeId}.${sig}`;
}

export function parseConsentToken(token: string): string | null {
  const [employeeId, sig] = token.split(".");
  if (!employeeId || !sig) return null;
  const expected = consentToken(employeeId).split(".")[1]!;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? employeeId : null;
}

/** Pre-consent disclosure (NOT-11). DRAFT: counsel to review against the DOL safe harbor. */
export const E_DELIVERY_DISCLOSURE = [
  "Covered documents: COBRA notices (general notice, election notice, premium and termination notices) for your employer's group health plans.",
  "You can withdraw this consent at any time, free of charge, from your COBRA portal or by contacting the administrator.",
  "You can get a free paper copy of any notice at any time.",
  "Keep your email address current: update it in the portal or tell your HR team.",
  "You need a device with internet access, a current web browser, and software that opens PDF files.",
];

/**
 * Go live (SET-10): requires every required module complete and a federal
 * COBRA group. Starts the electronic-delivery rollout: every enrolled
 * employee is asked to consent (NOT-9).
 */
export async function goLive(companyId: string, actor: Actor) {
  const overview = await setupOverview(companyId);
  if (!overview.canGoLive) throw new UserError(`Finish these first: ${overview.missing.join(", ").replace(/_/g, " ")}.`);
  const company = await getCompany(companyId);
  if (company.regime !== "federal") throw new UserError("Federal COBRA requires 20+ employees in the prior calendar year.");

  const db = await getDb();
  await db.update(tables.companies).set({ status: "live", liveAt: new Date() }).where(eq(tables.companies.id, companyId));
  await setModuleStatus(companyId, "review", "complete", { userId: actor.id ?? undefined });

  const employees = await db
    .select()
    .from(tables.employees)
    .where(and(eq(tables.employees.companyId, companyId), eq(tables.employees.status, "active")));
  let invited = 0;
  for (const e of employees) {
    if (!e.email) continue;
    await sendEmail(
      e.email,
      `${company.legalName}: get your COBRA notices electronically`,
      [
        `${company.legalName} uses COBRA on Demand to administer COBRA continuation coverage electronically.`,
        "If your health coverage ever ends, your COBRA notices will be sent by email to this address, but only if you agree.",
        `Review and give consent: ${appBaseUrl()}/consent/${consentToken(e.id)}`,
        "If you don't consent, notices will be mailed to your home address. Either way your COBRA rights are the same.",
      ].join("\n\n"),
      { companyId, relatedType: "employee", relatedId: e.id },
    );
    invited++;
  }
  await audit(actor, { companyId, action: "company.went_live", entityType: "company", entityId: companyId, after: { consentInvites: invited } });
  return { invited };
}

export async function getConsentContext(token: string) {
  const employeeId = parseConsentToken(token);
  if (!employeeId) return null;
  const db = await getDb();
  const [employee] = await db.select().from(tables.employees).where(eq(tables.employees.id, employeeId));
  if (!employee) return null;
  const company = await getCompany(employee.companyId);
  const [active] = await db
    .select()
    .from(tables.eDeliveryConsents)
    .where(and(eq(tables.eDeliveryConsents.employeeId, employeeId), isNull(tables.eDeliveryConsents.withdrawnAt)));
  return { employee: { id: employee.id, firstName: employee.firstName, email: employee.email }, company: { name: company.legalName }, consent: active ?? null };
}

/**
 * Affirmative, opt-in consent (NOT-10) that proves the person can open the
 * format: they must open the test PDF first (NOT-11). Silence is not consent.
 */
export async function recordConsent(token: string, input: { email: string; testPdfOpened: boolean; ip?: string; userAgent?: string }) {
  const ctx = await getConsentContext(token);
  if (!ctx) throw new UserError("This link isn't valid.");
  if (!input.testPdfOpened) throw new UserError("Open the test document first to confirm you can view PDF files.");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a personal email address.", "email");
  const db = await getDb();
  const [employee] = await db.select().from(tables.employees).where(eq(tables.employees.id, ctx.employee.id));
  await db.update(tables.eDeliveryConsents).set({ withdrawnAt: new Date() }).where(and(eq(tables.eDeliveryConsents.employeeId, employee!.id), isNull(tables.eDeliveryConsents.withdrawnAt)));
  await db.insert(tables.eDeliveryConsents).values({
    companyId: employee!.companyId,
    employeeId: employee!.id,
    email,
    disclosureVersion: E_DELIVERY_DISCLOSURE_VERSION,
    testPdfOpenedAt: new Date(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
  await db.update(tables.employees).set({ email }).where(eq(tables.employees.id, employee!.id));
  await audit({ type: "enrollee", id: employee!.id, ip: input.ip }, { companyId: employee!.companyId, action: "edelivery.consented", entityType: "employee", entityId: employee!.id, after: { email, version: E_DELIVERY_DISCLOSURE_VERSION } });
}

/** One-click withdrawal (NOT-12): free, and future notices go by mail. */
export async function withdrawConsent(token: string, meta: { ip?: string }) {
  const ctx = await getConsentContext(token);
  if (!ctx) throw new UserError("This link isn't valid.");
  const db = await getDb();
  await db.update(tables.eDeliveryConsents).set({ withdrawnAt: new Date() }).where(and(eq(tables.eDeliveryConsents.employeeId, ctx.employee.id), isNull(tables.eDeliveryConsents.withdrawnAt)));
  await audit({ type: "enrollee", id: ctx.employee.id, ip: meta.ip }, { action: "edelivery.withdrawn", entityType: "employee", entityId: ctx.employee.id });
}

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { encryptField, getDb, SETUP_MODULES, tables, type CompanySettings, type SetupModule } from "@cod/db";
import { COMPANY_POLICY, determineRegime } from "@cod/rules";
import { z } from "zod";
import { AGREEMENTS, agreementHash } from "./agreements";
import { audit, type Actor } from "./audit";

export class UserError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = "UserError";
  }
}

export const DEFAULT_SETTINGS: CompanySettings = {
  sendMode: "hold",
  autoProceedDays: COMPANY_POLICY.defaultAutoProceedDays,
  defaultSubsidy: null,
  remindersEnabled: true,
};

export const signupSchema = z.object({
  contactName: z.string().trim().min(2, "Enter your name."),
  contactRole: z.string().trim().min(2, "Enter your role."),
  contactTitle: z.string().trim().min(2, "Enter your title."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters."),
  companyName: z.string().trim().min(2, "Enter the company name."),
  state: z.string().trim().length(2, "Use the two-letter state code.").toUpperCase(),
  priorYearEmployeeCount: z.coerce.number().int().min(0, "Enter the employee count."),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the agreements to continue." }) }),
  confirmAuthority: z.literal(true, { errorMap: () => ({ message: "Confirm you can bind the company." }) }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(inc|llc|ltd|corp|co|corporation|company)\b\.?/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company"
  );
}

const RESERVED_SLUGS = new Set(["www", "app", "api", "admin", "ops", "mail", "help", "support", "status", "e"]);

async function uniqueSlug(base: string): Promise<string> {
  const db = await getDb();
  let slug = RESERVED_SLUGS.has(base) ? `${base}-co` : base;
  for (let i = 2; ; i++) {
    const existing = await db.select({ id: tables.companies.id }).from(tables.companies).where(eq(tables.companies.slug, slug));
    if (existing.length === 0) return slug;
    slug = `${base}-${i}`;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Short sign-up (ONB-1) with the federal COBRA size check up front (ONB-7) and
 * clickwrap agreements recorded with signer, authority, version, time and IP
 * (ONB-6). Everything else comes from the setup modules.
 */
export async function signUpEmployer(input: SignupInput, meta: { ip?: string; userAgent?: string }) {
  const regime = determineRegime({ priorYearEmployeeCount: input.priorYearEmployeeCount, state: input.state, hasInsuredPlan: true });
  if (!regime.supported) {
    throw new UserError(
      `${regime.reason} Groups under 20 employees aren't eligible for federal COBRA; ${input.state === "CA" ? "your carrier handles Cal-COBRA" : "check your state's continuation law with your carrier"}.`,
      "priorYearEmployeeCount",
    );
  }

  const db = await getDb();
  const existing = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, input.email));
  if (existing.length) throw new UserError("An account with this email already exists. Sign in instead.", "email");

  const slug = await uniqueSlug(slugify(input.companyName));
  const passwordHash = await hashPassword(input.password);

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(tables.users)
      .values({ email: input.email, passwordHash, name: input.contactName, kind: "employer" })
      .returning();
    const [company] = await tx
      .insert(tables.companies)
      .values({
        slug,
        legalName: input.companyName,
        state: input.state,
        priorYearEmployeeCount: input.priorYearEmployeeCount,
        regime: regime.regime,
        stateExtensionApplies: regime.stateExtensionApplies,
        contactName: input.contactName,
        contactRole: input.contactRole,
        contactTitle: input.contactTitle,
        contactEmail: input.email,
        hrContactName: input.contactName,
        hrContactEmail: input.email,
        planName: `${input.companyName} Group Health Plan`,
        settings: DEFAULT_SETTINGS,
      })
      .returning();
    await tx.insert(tables.companyUsers).values({ companyId: company!.id, userId: user!.id, role: "owner" });
    // The signing owner is the first admin user, so that module starts complete.
    await tx.insert(tables.setupModules).values(
      SETUP_MODULES.map((module) => ({
        companyId: company!.id,
        module,
        ...(module === "admin_users" ? { status: "complete" as const, sourceType: "manual", completedAt: new Date(), completedBy: user!.id } : {}),
      })),
    );
    await tx.insert(tables.billingAccounts).values({ companyId: company!.id });
    await tx.insert(tables.agreements).values(
      AGREEMENTS.map((a) => ({
        companyId: company!.id,
        type: a.type,
        version: a.version,
        signerName: input.contactName,
        signerTitle: input.contactTitle,
        authorityConfirmed: true,
        signedByUserId: user!.id,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        documentSha256: agreementHash(a),
      })),
    );
    return { user: user!, company: company! };
  });

  await audit({ type: "user", id: result.user.id, ip: meta.ip }, { companyId: result.company.id, action: "company.signup", entityType: "company", entityId: result.company.id, after: { slug, regime: regime.regime } });
  return result;
}

let dummyHash: Promise<string> | null = null;

export async function authenticateUser(email: string, password: string) {
  const db = await getDb();
  const [user] = await db.select().from(tables.users).where(eq(tables.users.email, email.trim().toLowerCase()));
  // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
  dummyHash ??= hashPassword("timing-equalizer");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) return null;
  await db.update(tables.users).set({ lastLoginAt: new Date() }).where(eq(tables.users.id, user.id));
  return user;
}

export async function getUser(userId: string) {
  const db = await getDb();
  const [user] = await db.select().from(tables.users).where(eq(tables.users.id, userId));
  return user ?? null;
}

/** The company and role for an employer user (first membership). */
export async function getMembership(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ company: tables.companies, role: tables.companyUsers.role })
    .from(tables.companyUsers)
    .innerJoin(tables.companies, eq(tables.companies.id, tables.companyUsers.companyId))
    .where(eq(tables.companyUsers.userId, userId));
  return row ?? null;
}

export async function getCompany(companyId: string) {
  const db = await getDb();
  const [c] = await db.select().from(tables.companies).where(eq(tables.companies.id, companyId));
  if (!c) throw new UserError("Company not found");
  return c;
}

export async function getCompanyBySlug(slug: string) {
  const db = await getDb();
  const [c] = await db.select().from(tables.companies).where(eq(tables.companies.slug, slug));
  return c ?? null;
}

export const profileSchema = z.object({
  legalName: z.string().trim().min(2),
  dba: z.string().trim().optional().default(""),
  ein: z.string().trim().regex(/^\d{2}-?\d{7}$/, "EIN must look like 12-3456789.").optional().or(z.literal("")),
  addressLine1: z.string().trim().min(3, "Enter the street address."),
  city: z.string().trim().min(2, "Enter the city."),
  state: z.string().trim().length(2).toUpperCase(),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a ZIP code."),
  phone: z.string().trim().min(7, "Enter a phone number."),
  priorYearEmployeeCount: z.coerce.number().int().min(0),
  benefitEligibleCount: z.coerce.number().int().min(0),
  benefitEnrolledCount: z.coerce.number().int().min(0),
  planName: z.string().trim().min(3),
  planYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the plan year start date."),
  planAdministratorName: z.string().trim().min(2),
  erisaPlanNumber: z.string().trim().optional().default(""),
  hrContactName: z.string().trim().min(2),
  hrContactPhone: z.string().trim().optional().default(""),
  hrContactEmail: z.string().trim().email(),
});

export async function updateCompanyProfile(companyId: string, input: z.infer<typeof profileSchema>, actor: Actor) {
  const regime = determineRegime({ priorYearEmployeeCount: input.priorYearEmployeeCount, state: input.state, hasInsuredPlan: true });
  const db = await getDb();
  const before = await getCompany(companyId);
  await db
    .update(tables.companies)
    .set({
      legalName: input.legalName,
      dba: input.dba || null,
      einEnc: input.ein ? encryptField(input.ein.replace(/-/g, "")) : before.einEnc,
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      phone: input.phone,
      priorYearEmployeeCount: input.priorYearEmployeeCount,
      benefitEligibleCount: input.benefitEligibleCount,
      benefitEnrolledCount: input.benefitEnrolledCount,
      regime: regime.regime,
      stateExtensionApplies: regime.stateExtensionApplies,
      planName: input.planName,
      planYearStart: input.planYearStart,
      planAdministratorName: input.planAdministratorName,
      erisaPlanNumber: input.erisaPlanNumber || null,
      hrContactName: input.hrContactName,
      hrContactPhone: input.hrContactPhone || null,
      hrContactEmail: input.hrContactEmail,
    })
    .where(eq(tables.companies.id, companyId));
  await setModuleStatus(companyId, "company_profile", "complete", { source: "manual", userId: actor.id ?? undefined });
  await audit(actor, { companyId, action: "company.profile_updated", entityType: "company", entityId: companyId, after: { regime: regime.regime } });
  return regime;
}

export async function updateSettings(companyId: string, settings: CompanySettings, actor: Actor) {
  const db = await getDb();
  await db.update(tables.companies).set({ settings }).where(eq(tables.companies.id, companyId));
  await setModuleStatus(companyId, "automation", "complete", { source: "manual", userId: actor.id ?? undefined });
  await audit(actor, { companyId, action: "company.settings_updated", entityType: "company", entityId: companyId, after: settings });
}

export async function setModuleStatus(
  companyId: string,
  module: SetupModule,
  status: "not_started" | "in_progress" | "needs_review" | "complete",
  opts: { source?: string; integrationId?: string; userId?: string; synced?: boolean } = {},
) {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(tables.setupModules)
    .where(and(eq(tables.setupModules.companyId, companyId), eq(tables.setupModules.module, module)));
  const history = current?.sourceHistory ?? [];
  const sourceChanged = opts.source && current?.sourceType && current.sourceType !== opts.source;
  await db
    .update(tables.setupModules)
    .set({
      status,
      sourceType: opts.source ?? current?.sourceType ?? null,
      integrationId: opts.integrationId ?? current?.integrationId ?? null,
      lastSyncedAt: opts.synced ? new Date() : current?.lastSyncedAt ?? null,
      completedAt: status === "complete" ? new Date() : null,
      completedBy: status === "complete" ? opts.userId ?? "system" : null,
      sourceHistory: sourceChanged ? [...history, { source: current!.sourceType!, switchedAt: new Date().toISOString() }] : history,
    })
    .where(and(eq(tables.setupModules.companyId, companyId), eq(tables.setupModules.module, module)));
}

import { desc, eq, ilike, or } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { validateTiers, type PriceTier } from "@cod/billing";
import { audit, type Actor } from "./audit";
import { UserError } from "./companies";

/** Ops console data (OPS-1 … OPS-5). */

export async function listCompanies() {
  const db = await getDb();
  return db.select().from(tables.companies).orderBy(desc(tables.companies.createdAt));
}

export async function searchEverything(q: string) {
  const db = await getDb();
  const term = `%${q.trim()}%`;
  if (q.trim().length < 2) return { companies: [], beneficiaries: [] };
  const [companies, beneficiaries] = await Promise.all([
    db.select().from(tables.companies).where(or(ilike(tables.companies.legalName, term), ilike(tables.companies.slug, term))).limit(20),
    db
      .select({ qb: tables.qualifiedBeneficiaries, companyName: tables.companies.legalName })
      .from(tables.qualifiedBeneficiaries)
      .innerJoin(tables.companies, eq(tables.companies.id, tables.qualifiedBeneficiaries.companyId))
      .where(or(ilike(tables.qualifiedBeneficiaries.lastName, term), ilike(tables.qualifiedBeneficiaries.firstName, term), ilike(tables.qualifiedBeneficiaries.email, term)))
      .limit(20),
  ]);
  return { companies, beneficiaries };
}

export async function listOutbox(limit = 100) {
  const db = await getDb();
  return db.select().from(tables.messages).orderBy(desc(tables.messages.createdAt)).limit(limit);
}

export async function listAudit(limit = 100) {
  const db = await getDb();
  return db.select().from(tables.auditLog).orderBy(desc(tables.auditLog.id)).limit(limit);
}

export async function getPriceTiers() {
  const db = await getDb();
  return db.select().from(tables.priceTiers).orderBy(tables.priceTiers.min);
}

/** Pricing is data set in admin, not code (BIL-2). Changes are validated and audited. */
export async function replacePriceTiers(tiers: PriceTier[], reason: string, actor: Actor) {
  const errors = validateTiers(tiers);
  if (errors.length) throw new UserError(errors.join(" "));
  if (reason.trim().length < 3) throw new UserError("A reason is required for pricing changes (OPS-5).");
  const db = await getDb();
  const before = await getPriceTiers();
  await db.transaction(async (tx) => {
    await tx.update(tables.priceTiers).set({ active: false }).where(eq(tables.priceTiers.plan, "standard"));
    await tx.insert(tables.priceTiers).values(tiers.map((t) => ({ plan: "standard" as const, min: t.min, max: t.max, unitPrice: t.unitPrice, active: true })));
  });
  await audit(actor, { action: "pricing.updated", entityType: "price_tiers", before, after: { tiers, reason } });
}

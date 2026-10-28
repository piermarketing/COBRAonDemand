import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, tables } from "@cod/db";

/** Read helpers for employer pages. Every query is scoped by company id. */

export async function setupData(companyId: string) {
  const db = await getDb();
  const [employees, dependents, plans, coverages, integrations, billing, users] = await Promise.all([
    db.select().from(tables.employees).where(eq(tables.employees.companyId, companyId)),
    db.select().from(tables.dependents).where(eq(tables.dependents.companyId, companyId)),
    db.select().from(tables.plans).where(eq(tables.plans.companyId, companyId)),
    db.select().from(tables.coverages).where(and(eq(tables.coverages.companyId, companyId), isNull(tables.coverages.endDate))),
    db.select().from(tables.integrations).where(eq(tables.integrations.companyId, companyId)),
    db.select().from(tables.billingAccounts).where(eq(tables.billingAccounts.companyId, companyId)),
    db
      .select({ name: tables.users.name, email: tables.users.email, role: tables.companyUsers.role, confirms: tables.companyUsers.confirmsTerminations })
      .from(tables.companyUsers)
      .innerJoin(tables.users, eq(tables.users.id, tables.companyUsers.userId))
      .where(eq(tables.companyUsers.companyId, companyId)),
  ]);
  const rates = plans.length ? await db.select().from(tables.planRates).where(inArray(tables.planRates.planId, plans.map((p) => p.id))) : [];
  const agreements = await db.select().from(tables.agreements).where(eq(tables.agreements.companyId, companyId));
  return { employees, dependents, plans, rates, coverages, integrations, billing: billing[0] ?? null, users, agreements };
}

export async function eventDetail(companyId: string, eventId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ event: tables.qualifyingEvents, employee: tables.employees })
    .from(tables.qualifyingEvents)
    .innerJoin(tables.employees, eq(tables.employees.id, tables.qualifyingEvents.employeeId))
    .where(and(eq(tables.qualifyingEvents.id, eventId), eq(tables.qualifyingEvents.companyId, companyId)));
  if (!row) return null;
  const [qbs, notices, invoices, elections] = await Promise.all([
    db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, eventId)),
    db.select().from(tables.notices).where(eq(tables.notices.eventId, eventId)),
    db.select().from(tables.premiumInvoices).where(eq(tables.premiumInvoices.eventId, eventId)),
    db.select().from(tables.elections).where(eq(tables.elections.eventId, eventId)),
  ]);
  return { ...row, qbs, notices, invoices, elections };
}

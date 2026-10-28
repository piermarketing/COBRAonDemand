import { and, eq, inArray, isNull } from "drizzle-orm";
import { encryptField, getDb, hashLast4, tables, type SetupModule } from "@cod/db";
import {
  parseCensusCsv,
  parsePlansCsv,
  sandboxSnapshot,
  type CanonicalDependent,
  type CanonicalEmployee,
  type CanonicalEnrollment,
  type CanonicalPlan,
  type RowError,
} from "@cod/integrations";
import { isCobraEligiblePlanType, TIERS, type PlanType, type Tier } from "@cod/rules";
import { audit, type Actor } from "./audit";
import { getCompany, setModuleStatus, UserError } from "./companies";
import { today } from "./env";

export interface ImportInput {
  employees?: CanonicalEmployee[];
  dependents?: CanonicalDependent[];
  plans?: CanonicalPlan[];
  enrollments?: CanonicalEnrollment[];
}

export interface ImportSummary {
  employees: { added: number; updated: number };
  dependents: { added: number; updated: number };
  plans: { added: number; updated: number };
  coverages: { added: number; ended: number };
  newTerminations: { employeeId: string; terminationDate: string; reason?: string }[];
  errors: RowError[];
}

/**
 * Apply canonical data from any source. Employees, dependents and plans are
 * upserted by source id; coverages missing from a new import are end-dated
 * rather than deleted, so a termination can still see what the person had
 * the day before coverage ended.
 */
export async function importCanonical(companyId: string, input: ImportInput, source: string, actor: Actor): Promise<ImportSummary> {
  const db = await getDb();
  const company = await getCompany(companyId);
  const asOf = today();
  const summary: ImportSummary = {
    employees: { added: 0, updated: 0 },
    dependents: { added: 0, updated: 0 },
    plans: { added: 0, updated: 0 },
    coverages: { added: 0, ended: 0 },
    newTerminations: [],
    errors: [],
  };

  await db.transaction(async (tx) => {
    const empIdBySource = new Map<string, string>();
    const existingEmployees = await tx.select().from(tables.employees).where(eq(tables.employees.companyId, companyId));
    existingEmployees.forEach((e) => empIdBySource.set(e.sourceId, e.id));

    for (const e of input.employees ?? []) {
      const prior = existingEmployees.find((x) => x.sourceId === e.sourceId);
      const values = {
        companyId,
        sourceId: e.sourceId,
        firstName: e.firstName,
        lastName: e.lastName,
        dobEnc: encryptField(e.dateOfBirth),
        ssnEnc: e.ssn ? encryptField(e.ssn) : prior?.ssnEnc ?? null,
        ssnLast4Hash: hashLast4(companyId, e.ssnLast4),
        address: e.address,
        email: e.personalEmail ?? prior?.email ?? null,
        phone: e.phone ?? prior?.phone ?? null,
        status: e.status,
        hireDate: e.hireDate,
        terminationDate: e.terminationDate ?? null,
        terminationReason: e.terminationReason ?? null,
        weeklyHours: e.weeklyHours ?? null,
        source,
        updatedAt: new Date(),
      };
      if (prior) {
        await tx.update(tables.employees).set(values).where(eq(tables.employees.id, prior.id));
        summary.employees.updated++;
        if (e.terminationDate && e.terminationDate !== prior.terminationDate) {
          summary.newTerminations.push({ employeeId: prior.id, terminationDate: e.terminationDate, reason: e.terminationReason });
        }
      } else {
        const [row] = await tx.insert(tables.employees).values(values).returning({ id: tables.employees.id });
        empIdBySource.set(e.sourceId, row!.id);
        summary.employees.added++;
        if (e.terminationDate) summary.newTerminations.push({ employeeId: row!.id, terminationDate: e.terminationDate, reason: e.terminationReason });
      }
    }

    const depIdBySource = new Map<string, string>();
    const existingDeps = await tx.select().from(tables.dependents).where(eq(tables.dependents.companyId, companyId));
    existingDeps.forEach((d) => depIdBySource.set(d.sourceId, d.id));
    for (const d of input.dependents ?? []) {
      const employeeId = empIdBySource.get(d.employeeSourceId);
      if (!employeeId) {
        summary.errors.push({ row: 0, message: `Dependent ${d.firstName} ${d.lastName}: employee ${d.employeeSourceId} not found.` });
        continue;
      }
      const values = {
        companyId,
        employeeId,
        sourceId: d.sourceId,
        firstName: d.firstName,
        lastName: d.lastName,
        dobEnc: encryptField(d.dateOfBirth),
        relationship: d.relationship,
        address: d.address ?? null,
        email: d.email ?? null,
      };
      const priorId = depIdBySource.get(d.sourceId);
      if (priorId) {
        await tx.update(tables.dependents).set(values).where(eq(tables.dependents.id, priorId));
        summary.dependents.updated++;
      } else {
        const [row] = await tx.insert(tables.dependents).values(values).returning({ id: tables.dependents.id });
        depIdBySource.set(d.sourceId, row!.id);
        summary.dependents.added++;
      }
    }

    const planIdByCode = new Map<string, string>();
    const existingPlans = await tx.select().from(tables.plans).where(eq(tables.plans.companyId, companyId));
    existingPlans.forEach((p) => planIdByCode.set(p.code, p.id));
    for (const p of input.plans ?? []) {
      const values = {
        companyId,
        code: p.sourceId,
        carrierName: p.carrier,
        name: p.name,
        type: p.type,
        groupNumber: p.groupNumber ?? null,
        insured: p.insured,
        cobraEligible: isCobraEligiblePlanType(p.type),
        planYearStart: p.planYearStart ?? company.planYearStart ?? null,
        source,
      };
      let planId = planIdByCode.get(p.sourceId);
      if (planId) {
        await tx.update(tables.plans).set(values).where(eq(tables.plans.id, planId));
        summary.plans.updated++;
      } else {
        const [row] = await tx.insert(tables.plans).values(values).returning({ id: tables.plans.id });
        planId = row!.id;
        planIdByCode.set(p.sourceId, planId);
        summary.plans.added++;
      }
      const effectiveFrom = p.planYearStart ?? company.planYearStart ?? `${asOf.slice(0, 4)}-01-01`;
      for (const [tier, monthlyCost] of Object.entries(p.ratesByTier)) {
        await tx
          .insert(tables.planRates)
          .values({ planId, tier: tier as Tier, monthlyCost: monthlyCost!, effectiveFrom })
          .onConflictDoUpdate({ target: [tables.planRates.planId, tables.planRates.tier, tables.planRates.effectiveFrom], set: { monthlyCost: monthlyCost! } });
      }
    }

    if (input.enrollments) {
      const employeeIds = [...new Set(input.enrollments.map((en) => empIdBySource.get(en.employeeSourceId)).filter(Boolean) as string[])];
      const open = employeeIds.length
        ? await tx
            .select()
            .from(tables.coverages)
            .where(and(eq(tables.coverages.companyId, companyId), inArray(tables.coverages.employeeId, employeeIds), isNull(tables.coverages.endDate)))
        : [];
      const key = (employeeId: string, dependentId: string | null, planId: string) => `${employeeId}|${dependentId ?? ""}|${planId}`;
      const openByKey = new Map(open.map((c) => [key(c.employeeId, c.dependentId, c.planId), c]));
      const seen = new Set<string>();

      for (const en of input.enrollments) {
        const employeeId = empIdBySource.get(en.employeeSourceId);
        const planId = planIdByCode.get(en.planSourceId);
        if (!employeeId) {
          summary.errors.push({ row: 0, message: `Election for unknown employee ${en.employeeSourceId}.` });
          continue;
        }
        if (!planId) {
          summary.errors.push({ row: 0, column: "plan", message: `Election references plan "${en.planSourceId}", which isn't set up. Add it in Set up plans.` });
          continue;
        }
        const dependentId = en.personSourceId === en.employeeSourceId ? null : depIdBySource.get(en.personSourceId) ?? null;
        if (en.personSourceId !== en.employeeSourceId && !dependentId) {
          summary.errors.push({ row: 0, message: `Election for unknown dependent ${en.personSourceId}.` });
          continue;
        }
        const k = key(employeeId, dependentId, planId);
        seen.add(k);
        const existing = openByKey.get(k);
        if (existing) {
          if (existing.tier !== en.tier || en.endDate) {
            await tx.update(tables.coverages).set({ tier: en.tier, endDate: en.endDate ?? null }).where(eq(tables.coverages.id, existing.id));
          }
        } else {
          await tx.insert(tables.coverages).values({ companyId, employeeId, dependentId, planId, tier: en.tier, startDate: en.effectiveDate, endDate: en.endDate ?? null });
          summary.coverages.added++;
        }
      }
      for (const c of open) {
        if (!seen.has(key(c.employeeId, c.dependentId, c.planId))) {
          await tx.update(tables.coverages).set({ endDate: asOf }).where(eq(tables.coverages.id, c.id));
          summary.coverages.ended++;
        }
      }
    }
  });

  await audit(actor, {
    companyId,
    action: "data.imported",
    entityType: "company",
    entityId: companyId,
    after: { source, employees: summary.employees, dependents: summary.dependents, plans: summary.plans, coverages: summary.coverages, errors: summary.errors.length },
  });
  return summary;
}

/** Census upload (CSV) feeding Employees, Dependents and Current elections. */
export async function importCensus(companyId: string, csv: string, actor: Actor) {
  const parsed = parseCensusCsv(csv, { asOf: today() });
  if (parsed.errors.length) return { ok: false as const, errors: parsed.errors, warnings: parsed.warnings };
  const db = await getDb();
  const plans = await db.select({ code: tables.plans.code }).from(tables.plans).where(eq(tables.plans.companyId, companyId));
  const known = new Set(plans.map((p) => p.code));
  const missing = parsed.referencedPlanCodes.filter((c) => !known.has(c));
  if (missing.length) {
    return {
      ok: false as const,
      errors: missing.map((c) => ({ row: 0, column: "plan", message: `Plan code "${c}" isn't set up yet. Add it in Set up plans first, or fix the code.` })),
      warnings: parsed.warnings,
    };
  }
  const summary = await importCanonical(companyId, parsed, "census_upload", actor);
  for (const m of ["employees", "dependents", "elections"] as const) {
    await setModuleStatus(companyId, m, "needs_review", { source: "census_upload", synced: true });
  }
  return { ok: true as const, summary, warnings: parsed.warnings };
}

export async function importPlansFile(companyId: string, csv: string, actor: Actor) {
  const { plans, errors } = parsePlansCsv(csv);
  if (errors.length) return { ok: false as const, errors };
  const summary = await importCanonical(companyId, { plans }, "carrier_document", actor);
  await setModuleStatus(companyId, "plans", "needs_review", { source: "carrier_document", synced: true });
  return { ok: true as const, summary };
}

export interface ManualPlanInput {
  code: string;
  carrierName: string;
  name: string;
  type: PlanType;
  groupNumber?: string;
  insured: boolean;
  coverageEndRule: "end_of_month" | "termination_date";
  /** Monthly total cost per tier in dollars. */
  rates: Partial<Record<Tier, number>>;
}

export async function saveManualPlan(companyId: string, input: ManualPlanInput, actor: Actor) {
  if (!input.code.trim()) throw new UserError("Plan code is required.", "code");
  const ratesByTier: CanonicalPlan["ratesByTier"] = {};
  for (const tier of TIERS) {
    const dollars = input.rates[tier];
    if (dollars !== undefined && !Number.isNaN(dollars)) {
      if (dollars < 0) throw new UserError("Rates can't be negative.", `rate_${tier}`);
      ratesByTier[tier] = Math.round(dollars * 100);
    }
  }
  await importCanonical(
    companyId,
    { plans: [{ sourceId: input.code.trim(), carrier: input.carrierName, name: input.name, type: input.type, groupNumber: input.groupNumber, insured: input.insured, ratesByTier }] },
    "manual",
    actor,
  );
  const db = await getDb();
  await db
    .update(tables.plans)
    .set({ coverageEndRule: input.coverageEndRule })
    .where(and(eq(tables.plans.companyId, companyId), eq(tables.plans.code, input.code.trim())));
  await setModuleStatus(companyId, "plans", "needs_review", { source: "manual" });
}

/** Connect the sandbox data source (stand-in for Finch / Employee Navigator). */
export async function connectSandbox(companyId: string, actor: Actor) {
  const db = await getDb();
  const snapshot = sandboxSnapshot();
  const [integration] = await db
    .insert(tables.integrations)
    .values({ companyId, provider: "sandbox", connectionId: `sandbox_${companyId.slice(0, 8)}`, lastSnapshot: snapshot, lastSyncAt: new Date() })
    .returning();
  const summary = await importCanonical(companyId, snapshot, "sandbox", actor);
  if (snapshot.employer) {
    const e = snapshot.employer;
    const company = await getCompany(companyId);
    await db
      .update(tables.companies)
      .set({
        addressLine1: company.addressLine1 ?? e.addressLine1 ?? null,
        city: company.city ?? e.city ?? null,
        postalCode: company.postalCode ?? e.postalCode ?? null,
        phone: company.phone ?? e.phone ?? null,
        planYearStart: company.planYearStart ?? e.planYearStart ?? null,
        benefitEligibleCount: company.benefitEligibleCount ?? snapshot.employees.length,
        benefitEnrolledCount: company.benefitEnrolledCount ?? new Set(snapshot.enrollments.map((x) => x.employeeSourceId)).size,
      })
      .where(eq(tables.companies.id, companyId));
  }
  for (const m of ["employees", "dependents", "plans", "elections"] as const) {
    await setModuleStatus(companyId, m, "needs_review", { source: "sandbox", integrationId: integration!.id, synced: true });
  }
  await db.insert(tables.syncRuns).values({ integrationId: integration!.id, finishedAt: new Date(), diffSummary: { initial: true, ...summary } });
  return { integration: integration!, summary };
}

export interface ModuleCheck {
  ok: boolean;
  issues: string[];
}

/** SET-7 / PLN-9 validation per module. */
export async function validateModule(companyId: string, module: SetupModule): Promise<ModuleCheck> {
  const db = await getDb();
  const issues: string[] = [];
  const company = await getCompany(companyId);

  if (module === "company_profile") {
    if (!company.addressLine1 || !company.city || !company.postalCode) issues.push("Company address is incomplete.");
    if (!company.einEnc) issues.push("EIN is missing.");
    if (!company.planYearStart) issues.push("Plan year start date is missing.");
    if (company.regime !== "federal") issues.push("Federal COBRA requires 20+ employees in the prior calendar year.");
  }

  if (module === "employees") {
    const emps = await db.select().from(tables.employees).where(eq(tables.employees.companyId, companyId));
    if (emps.length === 0) issues.push("No employees imported yet.");
    const noAddress = emps.filter((e) => !e.address?.line1).length;
    if (noAddress) issues.push(`${noAddress} employee(s) are missing a home address.`);
    const noEmail = emps.filter((e) => !e.email && e.status === "active").length;
    if (noEmail) issues.push(`${noEmail} active employee(s) have no personal email; their notices will be mailed (manual administration fee).`);
  }

  if (module === "plans") {
    const ps = await db.select().from(tables.plans).where(eq(tables.plans.companyId, companyId));
    const eligible = ps.filter((p) => p.cobraEligible);
    if (eligible.length === 0) issues.push("Add at least one COBRA-eligible plan (medical, dental, vision, HRA, FSA or EAP).");
    const rates = ps.length ? await db.select().from(tables.planRates).where(inArray(tables.planRates.planId, ps.map((p) => p.id))) : [];
    for (const p of eligible) {
      if (!rates.some((r) => r.planId === p.id)) issues.push(`${p.name} has no rates. COBRA needs the total monthly premium per tier.`);
    }
    const covs = ps.length
      ? await db.select().from(tables.coverages).where(and(eq(tables.coverages.companyId, companyId), isNull(tables.coverages.endDate)))
      : [];
    for (const c of covs) {
      const p = eligible.find((x) => x.id === c.planId);
      if (p && !rates.some((r) => r.planId === p.id && r.tier === c.tier)) {
        issues.push(`${p.name} has elections in the "${c.tier}" tier but no rate for it.`);
      }
    }
  }

  if (module === "elections") {
    const [emp, plans] = await Promise.all([validateModule(companyId, "employees"), validateModule(companyId, "plans")]);
    if (!emp.ok || !plans.ok) issues.push("Finish Set up employees and Set up plans first.");
    const covs = await db.select({ id: tables.coverages.id }).from(tables.coverages).where(eq(tables.coverages.companyId, companyId));
    if (covs.length === 0) issues.push("No current elections imported yet.");
  }

  if (module === "billing") {
    const [ba] = await db.select().from(tables.billingAccounts).where(eq(tables.billingAccounts.companyId, companyId));
    if (ba?.paymentMethodStatus !== "on_file") issues.push("Add a card or bank account for COBRA on Demand fees.");
  }

  // Warnings about mailed notices don't block completion.
  const blocking = issues.filter((i) => !i.includes("will be mailed"));
  return { ok: blocking.length === 0, issues };
}

export async function confirmModule(companyId: string, module: SetupModule, actor: Actor) {
  const check = await validateModule(companyId, module);
  if (!check.ok) throw new UserError(check.issues.join(" "));
  await setModuleStatus(companyId, module, "complete", { userId: actor.id ?? undefined });
  await audit(actor, { companyId, action: "setup.module_confirmed", entityType: "setup_module", entityId: module });
}

export const REQUIRED_MODULES: SetupModule[] = ["company_profile", "employees", "dependents", "plans", "elections", "admin_users", "billing"];

export async function setupOverview(companyId: string) {
  const db = await getDb();
  const rows = await db.select().from(tables.setupModules).where(eq(tables.setupModules.companyId, companyId));
  const company = await getCompany(companyId);
  const byModule = Object.fromEntries(rows.map((r) => [r.module, r])) as Record<SetupModule, (typeof rows)[number]>;
  const missing = REQUIRED_MODULES.filter((m) => byModule[m]?.status !== "complete");
  if (company.currentCobraEnrollees && company.currentCobraEnrollees > 0 && byModule.current_cobra?.status !== "complete") missing.push("current_cobra");
  return { modules: byModule, canGoLive: missing.length === 0 && company.status === "onboarding", missing, company };
}

export async function addBillingMethodDev(companyId: string, actor: Actor) {
  // Stripe hook: create a SetupIntent and confirm it with Stripe Elements; store only the PaymentMethod id.
  const db = await getDb();
  await db
    .update(tables.billingAccounts)
    .set({ paymentMethodStatus: "on_file", processorCustomerId: `dev_cus_${companyId.slice(0, 8)}`, paymentMethodSummary: "Test card ending 4242 (Stripe test mode)", updatedAt: new Date() })
    .where(eq(tables.billingAccounts.companyId, companyId));
  await setModuleStatus(companyId, "billing", "complete", { source: "stripe", userId: actor.id ?? undefined });
  await audit(actor, { companyId, action: "billing.method_added", entityType: "billing_account", entityId: companyId });
}

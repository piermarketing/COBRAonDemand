import { and, eq } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { detectEvents, type CanonicalSnapshot } from "@cod/integrations";
import { audit, SYSTEM, type Actor } from "./audit";
import { getCompany, UserError } from "./companies";
import { today } from "./env";
import { cancelEventsForEmployee, createQualifyingEvent } from "./events";
import { importCanonical } from "./setup";
import { openTask } from "./tasks";

/**
 * Run one sync for a connection (INT-8, INT-13, TRG-1, TRG-2): diff the new
 * snapshot against the last one, apply the data, then turn detected changes
 * into qualifying events. Terminations become events only after go-live;
 * during onboarding they are just recorded.
 */
export async function runSync(integrationId: string, next: CanonicalSnapshot, actor: Actor = SYSTEM) {
  const db = await getDb();
  const [integration] = await db.select().from(tables.integrations).where(eq(tables.integrations.id, integrationId));
  if (!integration) throw new UserError("Connection not found.");
  const company = await getCompany(integration.companyId);
  const prev = (integration.lastSnapshot as CanonicalSnapshot | null) ?? { takenAt: "", employees: [], dependents: [], plans: [], enrollments: [] };
  const asOf = today();
  const [run] = await db.insert(tables.syncRuns).values({ integrationId }).returning();

  const detected = detectEvents(prev, next, asOf);
  const summary = await importCanonical(company.id, next, integration.provider, actor);

  const created: string[] = [];
  if (company.status === "live") {
    for (const d of detected) {
      const [employee] = await db
        .select()
        .from(tables.employees)
        .where(and(eq(tables.employees.companyId, company.id), eq(tables.employees.sourceId, d.employeeSourceId)));
      if (!employee) continue;
      if (d.kind === "termination" || d.kind === "reduction_in_hours") {
        const r = await createQualifyingEvent({
          companyId: company.id,
          employeeId: employee.id,
          type: d.kind,
          eventDate: d.eventDate,
          source: "sync",
          reason: d.reason ?? d.detail,
          actor: SYSTEM,
        });
        created.push(r.id);
      } else if (d.kind === "rehire" || d.kind === "termination_cancelled") {
        await cancelEventsForEmployee(company.id, employee.id, d.detail);
      } else if (d.kind === "dependent_removed") {
        // QE-4: a dependent dropped in ben-admin needs the employer to say why (divorce? aging out?).
        await openTask({ companyId: company.id, type: "dependent_removed", title: `Dependent removed from coverage: ${employee.firstName} ${employee.lastName}'s household`, detail: d.detail, entityType: "employee", entityId: employee.id });
      }
    }
  }

  await db.update(tables.integrations).set({ lastSnapshot: next, lastSyncAt: new Date(), status: "connected" }).where(eq(tables.integrations.id, integrationId));
  await db
    .update(tables.syncRuns)
    .set({ finishedAt: new Date(), diffSummary: { detected: detected.map((d) => ({ kind: d.kind, employee: d.employeeSourceId, date: d.eventDate })), employees: summary.employees, coverages: summary.coverages }, errors: summary.errors.length ? summary.errors : null })
    .where(eq(tables.syncRuns.id, run!.id));
  await audit(actor, { companyId: company.id, action: "sync.completed", entityType: "integration", entityId: integrationId, after: { detected: detected.length, eventsCreated: created.length } });
  return { detected, eventsCreated: created, summary };
}

export async function getIntegrations(companyId: string) {
  const db = await getDb();
  return db.select().from(tables.integrations).where(eq(tables.integrations.companyId, companyId));
}

/**
 * Sandbox only: change the synthetic source data the way a payroll admin
 * would (enter a termination, change hours) and run the sync. Exercises the
 * whole loop without partner credentials (Employee Navigator pilot steps).
 */
export async function simulateSandboxChange(
  companyId: string,
  change: { kind: "terminate"; employeeSourceId: string; terminationDate: string; reason?: string } | { kind: "rehire"; employeeSourceId: string },
  actor: Actor,
) {
  const [integration] = (await getIntegrations(companyId)).filter((i) => i.provider === "sandbox");
  if (!integration) throw new UserError("Connect the sandbox data source first.");
  const snapshot = structuredClone(integration.lastSnapshot as CanonicalSnapshot);
  const emp = snapshot.employees.find((e) => e.sourceId === change.employeeSourceId);
  if (!emp) throw new UserError("Employee not found in the source system.");
  if (change.kind === "terminate") {
    emp.terminationDate = change.terminationDate;
    emp.terminationReason = change.reason ?? "voluntary";
    emp.status = change.terminationDate <= today() ? "terminated" : "active";
  } else {
    delete emp.terminationDate;
    delete emp.terminationReason;
    emp.status = "active";
  }
  snapshot.takenAt = new Date().toISOString();
  return runSync(integration.id, snapshot, actor);
}

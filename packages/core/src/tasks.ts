import { and, desc, eq } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { audit, type Actor } from "./audit";

/** Ops exception queue (OPS-2): returned mail, failed payments, late events, deadline risks, reversals. */
export async function openTask(input: {
  companyId?: string | null;
  type: string;
  title: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
  dueAt?: string;
}) {
  const db = await getDb();
  if (input.entityId) {
    const existing = await db
      .select({ id: tables.tasks.id })
      .from(tables.tasks)
      .where(and(eq(tables.tasks.type, input.type), eq(tables.tasks.entityId, input.entityId), eq(tables.tasks.status, "open")));
    if (existing.length) return existing[0]!.id;
  }
  const [row] = await db
    .insert(tables.tasks)
    .values({
      companyId: input.companyId ?? null,
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dueAt: input.dueAt ?? null,
    })
    .returning({ id: tables.tasks.id });
  return row!.id;
}

export async function resolveTask(taskId: string, resolution: string, actor: Actor) {
  if (resolution.trim().length < 3) throw new Error("A resolution note is required (OPS-5).");
  const db = await getDb();
  await db.update(tables.tasks).set({ status: "done", resolution, resolvedAt: new Date(), assignedTo: actor.id ?? null }).where(eq(tables.tasks.id, taskId));
  await audit(actor, { action: "task.resolved", entityType: "task", entityId: taskId, after: { resolution } });
}

export async function listTasks(status: "open" | "done" = "open") {
  const db = await getDb();
  return db
    .select({ task: tables.tasks, companyName: tables.companies.legalName })
    .from(tables.tasks)
    .leftJoin(tables.companies, eq(tables.companies.id, tables.tasks.companyId))
    .where(eq(tables.tasks.status, status))
    .orderBy(desc(tables.tasks.createdAt));
}

import { getDb, tables } from "@cod/db";

export interface Actor {
  type: "user" | "enrollee" | "system" | "ops";
  id?: string | null;
  ip?: string | null;
}

export const SYSTEM: Actor = { type: "system", id: null };

/** Append-only audit trail of every change to PHI and every state transition. */
export async function audit(
  actor: Actor,
  entry: { companyId?: string | null; action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown },
): Promise<void> {
  const db = await getDb();
  await db.insert(tables.auditLog).values({
    actorType: actor.type,
    actorId: actor.id ?? null,
    ip: actor.ip ?? null,
    companyId: entry.companyId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

import { dbDriver, getDb } from "@cod/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  await db.execute(sql`select 1`);
  return Response.json({ ok: true, db: dbDriver() });
}

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database client. With DATABASE_URL set (Cloud SQL in staging/prod) it uses
 * postgres-js. Without it, an embedded PGlite database in .data/ lets the app
 * run locally with no setup. Both speak the same Postgres dialect and share
 * one set of migrations.
 */

export type Db = ReturnType<typeof drizzlePostgres<typeof schema>>;

type DbState = { db: Db; ready: Promise<void>; driver: "postgres" | "pglite" };

const globalForDb = globalThis as unknown as { __codDb?: DbState };

/** Walk up from cwd to find the repo root (works from apps/web and from scripts). */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "packages", "db", "drizzle"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? path.join(repoRoot(), "packages", "db", "drizzle");
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(repoRoot(), ".data");
}

function create(): DbState {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 10) });
    const db = drizzlePostgres(client, { schema });
    const ready = process.env.DB_AUTO_MIGRATE === "true" ? migratePostgres(db, { migrationsFolder: migrationsFolder() }) : Promise.resolve();
    return { db, ready, driver: "postgres" };
  }
  const dir = path.join(dataDir(), "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const pg = drizzlePglite(client, { schema });
  const ready = migratePglite(pg, { migrationsFolder: migrationsFolder() });
  return { db: pg as unknown as Db, ready, driver: "pglite" };
}

function state(): DbState {
  if (!globalForDb.__codDb) globalForDb.__codDb = create();
  return globalForDb.__codDb;
}

/** Returns the database once migrations (PGlite / DB_AUTO_MIGRATE) have run. */
export async function getDb(): Promise<Db> {
  const s = state();
  await s.ready;
  return s.db;
}

export function dbDriver(): "postgres" | "pglite" {
  return state().driver;
}

export { schema };

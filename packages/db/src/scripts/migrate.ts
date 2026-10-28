import { dbDriver, getDb } from "../client";

/** Runs migrations (GH-6: a Cloud Run job runs this during deploy). PGlite migrates on first use. */
process.env.DB_AUTO_MIGRATE = "true";
await getDb();
console.log(`Migrations applied (${dbDriver()}).`);
process.exit(0);

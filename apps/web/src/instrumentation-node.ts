import { ensureBootstrapOpsUser } from "@cod/core";
import { getDb } from "@cod/db";

try {
  await getDb();
  await ensureBootstrapOpsUser();
} catch (err) {
  console.error("Startup database check failed", err);
}

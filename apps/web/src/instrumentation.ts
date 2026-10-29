/** Runs once when the server starts: apply migrations (DB_AUTO_MIGRATE) and create the first ops user. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}

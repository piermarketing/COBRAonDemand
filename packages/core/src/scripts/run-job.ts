/** Run a scheduled job from the command line (Cloud Run job entry point). Usage: npm run job -w @cod/core -- <name|all> */
import { JOBS, runAllJobs, runJob, type JobName } from "../index";

const name = process.argv[2] ?? "all";
if (name !== "all" && !(name in JOBS)) {
  console.error(`Unknown job "${name}". Jobs: ${Object.keys(JOBS).join(", ")}, all`);
  process.exit(1);
}
const result = name === "all" ? await runAllJobs() : await runJob(name as JobName);
console.log(JSON.stringify(result, null, 2));
process.exit(0);

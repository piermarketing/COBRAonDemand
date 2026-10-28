import { timingSafeEqual } from "node:crypto";
import { JOBS, runAllJobs, runJob, type JobName } from "@cod/core";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cloud Scheduler entry point: POST /api/jobs/{name} (or "all") with
 * Authorization: Bearer $CRON_SECRET. Jobs are idempotent and safe to retry.
 */
export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await params;
  if (job === "all") return Response.json(await runAllJobs());
  if (!(job in JOBS)) return Response.json({ error: "unknown job" }, { status: 404 });
  return Response.json(await runJob(job as JobName));
}

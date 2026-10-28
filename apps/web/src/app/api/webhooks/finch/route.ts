import { openTask } from "@cod/core";
import { verifyWebhook } from "@cod/integrations";

export const dynamic = "force-dynamic";

/**
 * Finch webhooks (employment.updated, directory.updated, account.updated).
 * Verify the HMAC signature, answer 2xx fast, and let the next sync pull the
 * full record: webhooks are thin, so the daily reconciliation is the source
 * of truth (INT-12, INT-13). The Finch connector wiring lands with partner access.
 */
export async function POST(req: Request) {
  const secret = process.env.FINCH_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  const check = verifyWebhook({ secret, body, signature: req.headers.get("finch-signature") ?? undefined, timestamp: req.headers.get("finch-timestamp") ?? undefined });
  if (!check.ok) return Response.json({ error: check.reason }, { status: 401 });
  const event = JSON.parse(body) as { type?: string; company_id?: string };
  if (event.type === "account.updated") {
    await openTask({ type: "connection_health", title: "Finch connection changed", detail: body.slice(0, 500) });
  }
  return Response.json({ received: true });
}

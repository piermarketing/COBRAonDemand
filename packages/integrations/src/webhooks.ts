import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_MAX_AGE_SECONDS = 300;

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * INT-12: verify HMAC-SHA256 webhook signatures with a constant-time compare
 * and reject timestamps more than 5 minutes old (replay protection).
 */
export function verifyWebhook(opts: {
  secret: string;
  body: string;
  signature: string | undefined;
  timestamp: string | undefined;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.signature || !opts.timestamp) return { ok: false, reason: "missing signature or timestamp" };
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > WEBHOOK_MAX_AGE_SECONDS) return { ok: false, reason: "timestamp outside replay window" };
  const expected = Buffer.from(signWebhook(opts.secret, ts, opts.body), "hex");
  const given = Buffer.from(opts.signature.replace(/^sha256=/, ""), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

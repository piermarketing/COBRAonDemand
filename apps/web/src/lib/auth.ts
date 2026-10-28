import "server-only";
import { getMembership, getUser, type Actor } from "@cod/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEnrolleeSession, getUserSession } from "./session";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
}

export async function userAgent(): Promise<string | undefined> {
  return (await headers()).get("user-agent") ?? undefined;
}

/** Signed-in employer with their company. Redirects to sign-in otherwise. */
export async function requireEmployer() {
  const s = await getUserSession();
  if (!s) redirect("/login");
  if (s.kind === "ops") redirect("/ops");
  const membership = await getMembership(s.userId);
  if (!membership) redirect("/login");
  const user = await getUser(s.userId);
  const actor: Actor = { type: "user", id: s.userId, ip: await clientIp() };
  return { user: user!, company: membership.company, role: membership.role, actor };
}

export async function requireWriter() {
  const ctx = await requireEmployer();
  if (ctx.role === "read_only" || ctx.role === "billing") throw new Error("Your role can't make changes.");
  return ctx;
}

export async function requireOps() {
  const s = await getUserSession();
  if (!s || s.kind !== "ops") redirect("/login");
  const user = await getUser(s.userId);
  const actor: Actor = { type: "ops", id: s.userId, ip: await clientIp() };
  return { user: user!, actor };
}

export async function requireEnrollee(slug: string) {
  const s = await getEnrolleeSession();
  if (!s || s.slug !== slug) redirect(`/e/${slug}`);
  return { session: s, actor: { type: "enrollee", id: s.qbId, ip: await clientIp() } as Actor };
}

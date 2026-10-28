import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

/**
 * Signed, httpOnly session cookies. Employers, brokers and ops staff share the
 * user session; enrollees get a separate, shorter session scoped to one
 * qualified beneficiary. Identity Platform (MFA) replaces password login in
 * production; the cookie format stays the same.
 */

const USER_COOKIE = "cod_session";
const ENROLLEE_COOKIE = "cod_enrollee";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-session-secret-change-me");
  if (!s || s.length < 16) throw new Error("SESSION_SECRET (16+ chars) is required in production");
  return new TextEncoder().encode(s);
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export interface UserSession {
  userId: string;
  kind: "employer" | "ops" | "broker";
}

export interface EnrolleeSession {
  qbId: string;
  companyId: string;
  eventId: string;
  slug: string;
}

async function sign(payload: Record<string, unknown>, ttlSeconds: number) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${ttlSeconds}s`).sign(secret());
}

async function read<T>(name: string): Promise<T | null> {
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}

export async function setUserSession(s: UserSession) {
  const ttl = 8 * 3600;
  (await cookies()).set(USER_COOKIE, await sign({ ...s }, ttl), cookieOpts(ttl));
}

export async function getUserSession() {
  return read<UserSession>(USER_COOKIE);
}

export async function setEnrolleeSession(s: EnrolleeSession) {
  const ttl = 2 * 3600;
  (await cookies()).set(ENROLLEE_COOKIE, await sign({ ...s }, ttl), cookieOpts(ttl));
}

export async function getEnrolleeSession() {
  return read<EnrolleeSession>(ENROLLEE_COOKIE);
}

export async function clearSessions() {
  const c = await cookies();
  c.delete(USER_COOKIE);
  c.delete(ENROLLEE_COOKIE);
}

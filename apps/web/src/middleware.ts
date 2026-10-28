import { NextResponse, type NextRequest } from "next/server";

/**
 * Subdomain → portal resolution. {company}.cobraondemand.com serves that
 * employer's enrollee portal; ops.cobraondemand.com serves the ops console;
 * the apex and www serve marketing and the employer app. On localhost,
 * {company}.localhost works the same way, and /e/{company} always works.
 */

const ROOT = process.env.APP_ROOT_DOMAIN ?? "cobraondemand.com";
const APEX_SUBDOMAINS = new Set(["www", "app"]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.includes(".")) return NextResponse.next();

  let sub: string | null = null;
  if (host.endsWith(`.${ROOT}`)) sub = host.slice(0, -(ROOT.length + 1));
  else if (host.endsWith(".localhost")) sub = host.slice(0, -".localhost".length);
  if (!sub || APEX_SUBDOMAINS.has(sub) || sub.includes(".")) return NextResponse.next();

  const url = req.nextUrl.clone();
  if (sub === "ops") {
    if (!pathname.startsWith("/ops") && pathname !== "/login") url.pathname = `/ops${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  if (!pathname.startsWith(`/e/${sub}`)) url.pathname = `/e/${sub}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

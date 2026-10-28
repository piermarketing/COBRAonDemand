import Link from "next/link";
import { Logo } from "@/components/site";
import { Badge } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { logoutAction } from "../(marketing)/login/actions";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/ops", label: "Exception queue" },
  { href: "/ops/companies", label: "Companies" },
  { href: "/ops/outbox", label: "Outbox" },
  { href: "/ops/pricing", label: "Pricing" },
  { href: "/ops/jobs", label: "Jobs" },
  { href: "/ops/audit", label: "Audit log" },
];

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireOps();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo href="/ops" />
            <Badge tone="danger">Ops</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <form action="/ops/search" className="hidden sm:block">
              <input name="q" placeholder="Search companies, people" className="rounded-md border border-line px-3 py-1.5 text-sm" />
            </form>
            <span className="text-ink-muted">{user.email}</span>
            <form action={logoutAction}>
              <button className="text-ink-soft hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap px-3 py-2 text-ink-soft hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}

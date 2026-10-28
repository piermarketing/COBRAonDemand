import Link from "next/link";
import { Logo } from "@/components/site";
import { Badge } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { logoutAction } from "../(marketing)/login/actions";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/setup", label: "Setup" },
  { href: "/dashboard/events", label: "Qualifying events" },
  { href: "/dashboard/enrollees", label: "Enrollees" },
  { href: "/dashboard/billing", label: "Billing" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { company, user } = await requireEmployer();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <Logo href="/dashboard" />
            <span className="hidden text-sm text-ink-muted sm:inline">{company.legalName}</span>
            {company.status === "live" ? <Badge tone="ok">Live</Badge> : <Badge tone="warn">Setting up</Badge>}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-ink-muted md:inline">{user.email}</span>
            <form action={logoutAction}>
              <button className="text-ink-soft hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-ink-soft hover:border-brand hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}

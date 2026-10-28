import Link from "next/link";
import { ADMINISTRATOR } from "@cod/core";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold text-ink">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white" aria-hidden>
        C
      </span>
      <span>
        COBRA <span className="text-brand">on Demand</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/pricing" className="text-ink-soft hover:text-ink">
            Pricing
          </Link>
          <Link href="/#faq" className="hidden text-ink-soft hover:text-ink sm:inline">
            FAQ
          </Link>
          <Link href="/login" className="text-ink-soft hover:text-ink">
            Sign in
          </Link>
          <Link href="/get-started" className="rounded-md bg-brand px-3 py-2 font-medium text-white hover:bg-brand-dark">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-6 text-xs text-ink-muted">
        <p>
          © {new Date().getFullYear()} {ADMINISTRATOR.name}. California Administrator Certificate No. {ADMINISTRATOR.caAdministratorCertificate}.
        </p>
        <p>
          {ADMINISTRATOR.phone} · {ADMINISTRATOR.email}
        </p>
      </div>
    </footer>
  );
}

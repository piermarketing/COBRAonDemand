import { notFound } from "next/navigation";
import { ADMINISTRATOR, getCompanyBySlug } from "@cod/core";

export const dynamic = "force-dynamic";

/** Company-specific enrollee portal: company.cobraondemand.com (ENR-1). Mobile-first. */
export default async function EnrolleeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ company: string }> }) {
  const { company: slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company || company.status !== "live") notFound();
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-base font-semibold text-ink">{company.legalName}</p>
            <p className="text-xs text-ink-muted">COBRA continuation coverage · administered by {ADMINISTRATOR.name}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-3xl px-4 py-5 text-xs text-ink-muted">
          Questions? {ADMINISTRATOR.phone} · {ADMINISTRATOR.email}. You can ask for a free paper copy of any notice at any time.
        </div>
      </footer>
    </div>
  );
}

import { employerDashboard } from "@cod/core";
import { ButtonLink, Card, PageHeader, Table } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { date, humanize, money } from "@/lib/format";

export const metadata = { title: "Enrollees" };

const BUCKETS = ["All", "Active", "Grace", "Pending", "Ended"] as const;

export default async function Enrollees({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { company, role } = await requireEmployer();
  const sp = await searchParams;
  const d = await employerDashboard(company.id, "ytd");
  const status = BUCKETS.includes(sp.status as (typeof BUCKETS)[number]) ? sp.status! : "All";
  const q = (sp.q ?? "").toLowerCase();
  const rows = d.enrollees.filter((e) => (status === "All" || e.bucket === status) && (!q || e.name.toLowerCase().includes(q) || e.plans.join(" ").toLowerCase().includes(q)));
  // RPT-3: read-only users see counts but not personal details.
  const showDetails = role !== "read_only";

  return (
    <div className="space-y-6">
      <PageHeader title="Enrollees" subtitle={`${d.tiles.activeEnrollees} active today`} action={<ButtonLink href="/api/reports/enrollees" variant="secondary">Export CSV</ButtonLink>} />
      <form className="flex flex-wrap gap-2 text-sm">
        <select name="status" defaultValue={status} className="rounded-md border border-line bg-white px-2 py-1.5">
          {BUCKETS.map((b) => <option key={b}>{b}</option>)}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Search name or plan" className="rounded-md border border-line px-3 py-1.5" />
        <button className="rounded-md bg-brand px-3 py-1.5 text-white">Filter</button>
      </form>
      <Card>
        {showDetails ? (
          <Table
            headers={["Name", "Relationship", "Plans", "COBRA start", "Max end", "Paid through", "Household premium", "Subsidy", "Status"]}
            rows={rows.map((e) => [e.name, humanize(e.relationship), e.plans.join(", ") || "—", date(e.cobraStart), date(e.maxCoverageEnd), date(e.paidThrough), money(e.householdMonthly), e.subsidy ? `${e.subsidy}%` : "—", e.statusLabel])}
            empty="No enrollees match."
          />
        ) : (
          <p className="text-sm text-ink-soft">{rows.length} people match. Your role shows counts only.</p>
        )}
      </Card>
    </div>
  );
}

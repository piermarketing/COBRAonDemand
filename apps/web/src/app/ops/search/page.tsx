import { searchEverything } from "@cod/core";
import { QB_STATUS_LABELS, type QbStatus } from "@cod/rules";
import { Card, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Ops · Search" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const r = await searchEverything(q);
  return (
    <>
      <PageHeader title={`Search: ${q}`} />
      <div className="space-y-6">
        <Card title="Companies">
          <Table headers={["Company", "Slug", "Status"]} rows={r.companies.map((c) => [c.legalName, c.slug, c.status])} empty="No companies match." />
        </Card>
        <Card title="Qualified beneficiaries">
          <Table headers={["Name", "Company", "Status", "Email"]} rows={r.beneficiaries.map(({ qb, companyName }) => [`${qb.firstName} ${qb.lastName}`, companyName, QB_STATUS_LABELS[qb.status as QbStatus] ?? qb.status, qb.email ?? "—"])} empty="No people match." />
        </Card>
      </div>
    </>
  );
}

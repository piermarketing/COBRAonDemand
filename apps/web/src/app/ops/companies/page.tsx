import { enrolleeUrl, listCompanies } from "@cod/core";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { dateTime, humanize } from "@/lib/format";

export const metadata = { title: "Ops · Companies" };

export default async function Companies() {
  const companies = await listCompanies();
  return (
    <>
      <PageHeader title="Companies" subtitle={`${companies.length} tenants`} />
      <Card>
        <Table
          headers={["Company", "Status", "State", "Employees", "Regime", "Contact", "Created", "Enrollee portal"]}
          rows={companies.map((c) => [
            c.legalName,
            <Badge key="s" tone={c.status === "live" ? "ok" : "warn"}>{humanize(c.status)}</Badge>,
            c.state,
            c.priorYearEmployeeCount ?? "—",
            c.regime ?? "—",
            `${c.contactName} · ${c.contactEmail}`,
            dateTime(c.createdAt),
            c.status === "live" ? <a key="u" href={enrolleeUrl(c.slug)} className="text-brand">{c.slug}</a> : c.slug,
          ])}
        />
      </Card>
    </>
  );
}

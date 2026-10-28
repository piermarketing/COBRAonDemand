import { listAudit } from "@cod/core";
import { Card, PageHeader, Table } from "@/components/ui";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Ops · Audit log" };

export default async function Audit() {
  const rows = await listAudit(200);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every change and state transition (retained 6+ years)." />
      <Card>
        <Table
          headers={["When", "Actor", "Action", "Entity", "Details"]}
          rows={rows.map((r) => [dateTime(r.at), `${r.actorType}${r.actorId ? ` · ${r.actorId.slice(0, 8)}` : ""}`, r.action, `${r.entityType}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}`, <code key="d" className="text-xs">{r.after ? JSON.stringify(r.after).slice(0, 160) : ""}</code>])}
        />
      </Card>
    </>
  );
}

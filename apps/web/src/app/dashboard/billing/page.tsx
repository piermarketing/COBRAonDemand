import { activePriceTiers, employerBillingSummary, manualAdminFee } from "@cod/core";
import { Card, PageHeader, Table } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { setupData } from "@/lib/data";
import { money } from "@/lib/format";

export const metadata = { title: "Billing" };

export default async function Billing() {
  const { company } = await requireEmployer();
  const [summary, tiers, data] = await Promise.all([employerBillingSummary(company.id), activePriceTiers(), setupData(company.id)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle={data.billing?.paymentMethodSummary ?? "No payment method on file"} />
      <Card title="Your rates">
        <ul className="space-y-1 text-sm text-ink-soft">
          {tiers.map((t, i) => (
            <li key={i}>
              {money(t.unitPrice)} per packet sent and per active enrollee month{tiers.length > 1 ? ` (${t.min}${t.max === null ? "+" : `–${t.max}`} units a month)` : ""}
            </li>
          ))}
          <li>{money(manualAdminFee())} manual administration per participant without e-delivery consent</li>
        </ul>
      </Card>
      <Card title="Charges by month">
        <Table
          headers={["Month", "Packets sent", "Enrollee months", "Manual administration", "Total"]}
          rows={summary.map((s) => [s.period, s.packets, s.enrolleeMonths, s.manual, money(s.total)])}
          empty="No charges yet. You're billed when the first packet is sent."
        />
      </Card>
    </div>
  );
}

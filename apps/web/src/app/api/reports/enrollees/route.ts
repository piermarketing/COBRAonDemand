import { employerDashboard, getMembership } from "@cod/core";
import { toCsv } from "@cod/integrations";
import { getUserSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getUserSession();
  const membership = s ? await getMembership(s.userId) : null;
  if (!membership || membership.role === "read_only") return new Response("Not found", { status: 404 });
  const d = await employerDashboard(membership.company.id, "ytd");
  const csv = toCsv([
    ["Name", "Relationship", "Plans", "COBRA start", "Max coverage end", "Paid through", "Household monthly premium", "Subsidy %", "Status"],
    ...d.enrollees.map((e) => [e.name, e.relationship, e.plans.join("; "), e.cobraStart, e.maxCoverageEnd, e.paidThrough ?? "", (e.householdMonthly / 100).toFixed(2), e.subsidy || "", e.statusLabel]),
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="cobra-enrollees-${d.asOf}.csv"`, "Cache-Control": "private, no-store" } });
}

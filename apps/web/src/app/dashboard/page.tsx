import Link from "next/link";
import { redirect } from "next/navigation";
import { employerDashboard, type TimeFrame } from "@cod/core";
import { Alert, Badge, Card, PageHeader, Stat, Table } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { date, humanize, money } from "@/lib/format";

export const metadata = { title: "Dashboard" };

const FRAMES: { value: TimeFrame; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "this_quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
];

const URGENCY_TONE = { overdue: "danger", critical: "danger", soon: "warn", ok: "neutral" } as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tf?: string; from?: string; to?: string; live?: string }> }) {
  const { company } = await requireEmployer();
  if (company.status === "onboarding") redirect("/dashboard/setup");
  const sp = await searchParams;
  const tf = (FRAMES.some((f) => f.value === sp.tf) || sp.tf === "custom" ? sp.tf : "this_month") as TimeFrame;
  const d = await employerDashboard(company.id, tf, sp.from && sp.to ? { from: sp.from, to: sp.to } : undefined);
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.enrolled));

  return (
    <div className="space-y-6">
      {sp.live && (
        <Alert tone="ok" title="You're live">
          Terminations from your data source now start the COBRA process automatically. We've emailed your employees the electronic-delivery consent request.
        </Alert>
      )}
      <PageHeader
        title="Dashboard"
        subtitle={`${d.range.label}: ${date(d.range.from)} to ${date(d.range.to)}`}
        action={
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <select name="tf" defaultValue={tf} className="rounded-md border border-line bg-white px-2 py-1.5">
              {FRAMES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
              <option value="custom">Custom range</option>
            </select>
            <input type="date" name="from" defaultValue={sp.from} className="rounded-md border border-line px-2 py-1" aria-label="From" />
            <input type="date" name="to" defaultValue={sp.to} className="rounded-md border border-line px-2 py-1" aria-label="To" />
            <button className="rounded-md bg-brand px-3 py-1.5 text-white">Apply</button>
          </form>
        }
      />

      {d.pendingEvents.length > 0 && (
        <Card title="Needs attention: pending qualifying events">
          <Table
            headers={["Employee", "Event", "Status", "Send by", "Days left", ""]}
            rows={d.pendingEvents.map((e) => [
              e.name,
              humanize(e.type),
              humanize(e.status),
              date(e.sendBy),
              <Badge key="u" tone={URGENCY_TONE[e.urgency]}>{e.daysLeft < 0 ? `${-e.daysLeft} days late` : `${e.daysLeft} days`}</Badge>,
              <Link key="l" href={`/dashboard/events/${e.id}`} className="text-brand">
                {e.status === "pending_confirmation" ? "Confirm" : "View"}
              </Link>,
            ])}
          />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Active COBRA enrollees" value={d.tiles.activeEnrollees} hint={`${d.tiles.activeHouseholds} households · as of today`} href="/dashboard/enrollees?status=Active" />
        <Stat label="New this week" value={d.tiles.newThisWeek} href="/dashboard/enrollees" />
        <Stat label="New this month" value={d.tiles.newThisMonth} href="/dashboard/enrollees" />
        <Stat label="New in time frame" value={d.tiles.newInRange} href="/dashboard/enrollees" />
        <Stat label="Pending elections" value={d.pendingElections.length} hint="Notice sent, window open" href="/dashboard/enrollees?status=Pending" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="COBRA premium in time frame" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Billed</dt><dd className="font-medium tabular-nums">{money(d.premium.billed)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Collected</dt><dd className="font-medium tabular-nums text-ok">{money(d.premium.collected)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Outstanding</dt><dd className="font-medium tabular-nums text-warn">{money(d.premium.outstanding)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Employer-paid subsidy</dt><dd className="font-medium tabular-nums">{money(d.premium.employerSubsidy)}</dd></div>
          </dl>
        </Card>

        <Card title="Active enrollees over time" className="lg:col-span-2">
          {d.trend.length === 0 ? (
            <p className="text-sm text-ink-muted">No data in this range.</p>
          ) : (
            <div className="flex h-40 items-end gap-2" role="img" aria-label="Active enrollees by month">
              {d.trend.map((t) => (
                <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs tabular-nums text-ink-soft">{t.enrolled}</span>
                  <div className="w-full rounded-t bg-brand/80" style={{ height: `${(t.enrolled / maxTrend) * 100}%`, minHeight: t.enrolled ? 4 : 1 }} title={`${t.month}: ${t.enrolled} enrolled, ${money(t.collected)} collected`} />
                  <span className="text-[10px] text-ink-muted">{t.month.slice(2)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Pending elections">
          <Table
            headers={["Name", "Relationship", "Deadline", "Days left"]}
            rows={d.pendingElections.map((p) => [p.name, humanize(p.relationship), date(p.deadline), <span key="d" className={p.daysLeft <= 7 ? "text-warn" : ""}>{p.daysLeft}</span>])}
            empty="No one is in their election window."
          />
        </Card>
        <Card title="Watch list">
          <div className="space-y-3 text-sm">
            <p><span className="font-medium text-ink">In grace period now:</span> {d.watch.inGrace.length ? d.watch.inGrace.map((x) => x.name).join(", ") : "none"}</p>
            <p><span className="font-medium text-ink">Coverage ending in 30 days:</span> {d.watch.ending30.length ? d.watch.ending30.map((x) => `${x.name} (${date(x.endDate)})`).join(", ") : "none"}</p>
            <p><span className="font-medium text-ink">Ending in 31–60 days:</span> {d.watch.ending60.length ? d.watch.ending60.map((x) => `${x.name} (${date(x.endDate)})`).join(", ") : "none"}</p>
            <p><span className="font-medium text-ink">Ended in time frame:</span> {Object.keys(d.endedByReason).length ? Object.entries(d.endedByReason).map(([r, n]) => `${humanize(r)}: ${n}`).join(", ") : "none"}</p>
          </div>
        </Card>
      </div>

      <Card title="Premium by plan">
        <Table headers={["Plan", "Active enrollees", "Premium billed in time frame"]} rows={d.premiumByPlan.map((p) => [p.plan, p.enrollees, money(p.premium)])} empty="No premium billed in this range." />
      </Card>
    </div>
  );
}

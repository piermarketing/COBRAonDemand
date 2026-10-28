import Link from "next/link";
import { getIntegrations, listEvents, today } from "@cod/core";
import { deadlineUrgency, EVENT_LABELS, QUALIFYING_EVENT_TYPES } from "@cod/rules";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { setupData } from "@/lib/data";
import { date, humanize } from "@/lib/format";
import { reportEventAction, simulateTerminationAction } from "../actions";

export const metadata = { title: "Qualifying events" };

const STATUS_TONE: Record<string, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  pending_confirmation: "warn",
  scheduled: "brand",
  ready: "brand",
  sent: "ok",
  cancelled: "neutral",
  no_coverage: "neutral",
  needs_review: "warn",
};

export default async function EventsPage() {
  const { company } = await requireEmployer();
  const [events, data, integrations] = await Promise.all([listEvents(company.id), setupData(company.id), getIntegrations(company.id)]);
  const asOf = today();
  const sorted = [...events].sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime());
  const sandbox = integrations.find((i) => i.provider === "sandbox");
  const sandboxEmployees = sandbox ? ((sandbox.lastSnapshot as { employees: { sourceId: string; firstName: string; lastName: string; terminationDate?: string }[] })?.employees ?? []) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Qualifying events" subtitle="Terminations detected from your data source start here. Every legal deadline is tracked for you." />

      <Card title="All events">
        <Table
          headers={["Employee", "Event", "Event date", "Status", "Notice deadline", "Source", ""]}
          rows={sorted.map(({ event, employee }) => {
            const u = deadlineUrgency(event.sendBy, asOf);
            const open = ["pending_confirmation", "scheduled", "ready"].includes(event.status);
            return [
              `${employee.firstName} ${employee.lastName}`,
              EVENT_LABELS[event.type as keyof typeof EVENT_LABELS] ?? event.type,
              date(event.eventDate),
              <Badge key="s" tone={STATUS_TONE[event.status] ?? "neutral"}>{humanize(event.status)}</Badge>,
              <span key="d">
                {date(event.electionNoticeDue)}
                {open && <span className={u.urgency === "ok" ? "text-ink-muted" : "text-danger"}> · {u.daysLeft} days</span>}
              </span>,
              humanize(event.source),
              <Link key="l" href={`/dashboard/events/${event.id}`} className="text-brand">View</Link>,
            ];
          })}
          empty="No qualifying events yet."
        />
      </Card>

      {company.status === "live" && (
        <Card title="Report an event manually">
          <p className="mb-4 text-sm text-ink-soft">Use this for events your data source can&apos;t show: a death, divorce, a child aging out, Medicare entitlement, or a termination entered late.</p>
          <ActionForm action={reportEventAction} className="grid gap-4 sm:grid-cols-3">
            <Field label="Employee">
              <Select name="employeeId" required>
                {data.employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </Select>
            </Field>
            <Field label="Event type">
              <Select name="type" defaultValue="termination">
                {QUALIFYING_EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}
              </Select>
            </Field>
            <Field label="Event date"><Input type="date" name="eventDate" required /></Field>
            <Field label="Last day of coverage (optional)" hint="Leave blank to use each plan's rule."><Input type="date" name="lastCoveredDay" /></Field>
            <Field label="Dependent (for divorce or aging out)">
              <Select name="dependentId" defaultValue="">
                <option value="">—</option>
                {data.dependents.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName} ({d.relationship})</option>)}
              </Select>
            </Field>
            <Field label="Reason (optional)"><Input name="reason" /></Field>
            <Field label="Company-paid months (optional)"><Input type="number" name="subsidyMonths" min={0} max={18} /></Field>
            <Field label="Company-paid %"><Input type="number" name="subsidyPercent" min={0} max={100} /></Field>
            <div className="sm:col-span-3 rounded-md border border-line bg-paper p-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="grossMisconduct" /> Termination for gross misconduct (removes COBRA rights)</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input name="grossMisconductReason" placeholder="Written reason (required if checked)" />
                <label className="flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" name="grossMisconductConfirm" /> I confirm this was reviewed with counsel; it is never inferred from a reason code.</label>
              </div>
            </div>
            <div className="sm:col-span-3"><SubmitButton>Report event</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      {sandbox && (
        <Card title="Sandbox: change source data">
          <p className="mb-4 text-sm text-ink-soft">Acts like a payroll admin editing the connected system, then runs the sync. Use it to test the full loop with synthetic people.</p>
          <ActionForm action={simulateTerminationAction} className="grid gap-4 sm:grid-cols-4">
            <Field label="Employee">
              <Select name="employeeSourceId">
                {sandboxEmployees.map((e) => <option key={e.sourceId} value={e.sourceId}>{e.firstName} {e.lastName}{e.terminationDate ? ` (terminated ${e.terminationDate})` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Change">
              <Select name="kind" defaultValue="terminate"><option value="terminate">Enter termination</option><option value="rehire">Remove termination / rehire</option></Select>
            </Field>
            <Field label="Termination date"><Input type="date" name="terminationDate" defaultValue={asOf} /></Field>
            <div className="flex items-end"><SubmitButton variant="secondary">Apply and sync</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

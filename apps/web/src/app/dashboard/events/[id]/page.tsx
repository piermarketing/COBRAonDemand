import Link from "next/link";
import { notFound } from "next/navigation";
import { today } from "@cod/core";
import { deadlineUrgency, EVENT_LABELS, QB_STATUS_LABELS, type QbStatus } from "@cod/rules";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, Input, PageHeader, Table } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { eventDetail } from "@/lib/data";
import { date, dateTime, humanize, money } from "@/lib/format";
import { cancelEventAction, confirmEventAction } from "../../actions";

const DONE: Record<string, string> = {
  sent: "Confirmed. The election packet has been sent.",
  cancelled: "Event cancelled. No packet will be sent.",
  reversal: "The packet was already sent, so our team will follow up on the reversal.",
};

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  const { company } = await requireEmployer();
  const d = await eventDetail(company.id, id);
  if (!d) notFound();
  const { event, employee, qbs, notices, invoices } = d;
  const u = deadlineUrgency(event.sendBy, today());
  const open = ["pending_confirmation", "scheduled", "ready"].includes(event.status);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/events" className="text-sm text-brand">← Qualifying events</Link>
        <PageHeader
          title={`${employee.firstName} ${employee.lastName}`}
          subtitle={`${EVENT_LABELS[event.type as keyof typeof EVENT_LABELS] ?? event.type} on ${date(event.eventDate, "long")} · reported via ${humanize(event.source)}`}
          action={<Badge tone={event.status === "sent" ? "ok" : open ? "warn" : "neutral"}>{humanize(event.status)}</Badge>}
        />
      </div>

      {done && DONE[done] && <Alert tone="ok">{DONE[done]}</Alert>}
      {event.status === "pending_confirmation" && (
        <Alert tone="warn" title="Confirm this termination">
          We detected it in your data source. Confirm to send the packet now. If you do nothing, it goes out automatically on {date(event.autoProceedOn)}.
        </Alert>
      )}
      {event.status === "scheduled" && <Alert tone="brand">This termination is future-dated. The packet will go out once {date(event.eventDate)} arrives.</Alert>}
      {event.status === "no_coverage" && <Alert>No one was on a COBRA-eligible plan the day before coverage ended, so no packet is needed and there is no charge.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Deadlines" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Last day of coverage</dt><dd>{date(event.lastCoveredDay)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Received</dt><dd>{date(event.receivedOn)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Employer report due</dt><dd>{date(event.reportDue)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Election notice due</dt><dd>{date(event.electionNoticeDue)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Our send-by date</dt><dd>{date(event.sendBy)}{open && <span className={u.urgency === "ok" ? "text-ink-muted" : "text-danger"}> ({u.daysLeft}d)</span>}</dd></div>
            {event.subsidyMonths ? <div className="flex justify-between"><dt className="text-ink-soft">Company-paid</dt><dd>{event.subsidyPercent}% for {event.subsidyMonths} mo</dd></div> : null}
          </dl>
        </Card>

        <Card title="Qualified beneficiaries" className="lg:col-span-2">
          <Table
            headers={["Name", "Relationship", "Status", "COBRA start", "Max coverage", "Election deadline"]}
            rows={qbs.map((q) => [`${q.firstName} ${q.lastName}`, humanize(q.relationship), QB_STATUS_LABELS[q.status as QbStatus] ?? q.status, date(q.cobraStart), date(q.maxCoverageEnd), date(q.electionDeadline)])}
          />
        </Card>
      </div>

      <Card title="Notices">
        <Table
          headers={["Type", "To", "Channel", "Sent", "Delivery", ""]}
          rows={notices.map((n) => [
            humanize(n.type),
            n.addresseeName,
            humanize(n.channel ?? "—"),
            dateTime(n.sentAt),
            n.mailTrackingId ? `Mail tracking ${n.mailTrackingId}` : humanize(n.status),
            n.documentId ? <a key="p" className="text-brand" href={`/api/notices/${n.id}/pdf`}>PDF</a> : "",
          ])}
          empty="No notices sent yet."
        />
      </Card>

      {invoices.length > 0 && (
        <Card title="Premium invoices">
          <Table headers={["Period", "Due", "Final day to pay", "Enrollee share", "Company-paid", "Status"]} rows={invoices.filter((i) => i.status !== "void").map((i) => [`${date(i.periodStart)} – ${date(i.periodEnd)}`, date(i.dueDate), date(i.finalPaymentDate), money(i.amountDue), money(i.subsidyAmount), humanize(i.status)])} />
        </Card>
      )}

      {(open || event.status === "sent") && (
        <div className="grid gap-6 md:grid-cols-2">
          {event.status === "pending_confirmation" && (
            <Card title="Confirm">
              <ActionForm action={confirmEventAction.bind(null, event.id)}>
                <p className="text-sm text-ink-soft">Sends the election packet to every qualified beneficiary now.</p>
                <SubmitButton pending="Sending…">Confirm and send</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title={event.status === "sent" ? "Report a reversal" : "Reject or cancel"}>
            <ActionForm action={cancelEventAction.bind(null, event.id)}>
              <Input name="reason" placeholder="Rehired, entered in error…" required />
              <SubmitButton variant="secondary">{event.status === "sent" ? "Report reversal" : "Cancel event"}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}
    </div>
  );
}

import { listTasks } from "@cod/core";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, Input, PageHeader } from "@/components/ui";
import { date, dateTime, humanize } from "@/lib/format";
import { resolveTaskAction } from "./actions";

export const metadata = { title: "Ops · Exception queue" };

export default async function OpsQueue() {
  const tasks = await listTasks("open");
  return (
    <>
      <PageHeader title="Exception queue" subtitle="Late events, deadline risks, reversals after mailing, returned mail, failed payments, takeovers and paper requests." />
      <div className="space-y-3">
        {tasks.length === 0 && <Card><p className="text-sm text-ink-muted">Nothing open. Every normal case is running without a human touch.</p></Card>}
        {tasks.map(({ task, companyName }) => (
          <Card key={task.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={task.type === "deadline_risk" || task.type === "late_event" ? "danger" : "warn"}>{humanize(task.type)}</Badge>
                  <span className="text-xs text-ink-muted">{companyName ?? "—"} · opened {dateTime(task.createdAt)}{task.dueAt ? ` · due ${date(task.dueAt)}` : ""}</span>
                </div>
                <p className="mt-2 font-medium text-ink">{task.title}</p>
                {task.detail && <p className="mt-1 text-sm text-ink-soft">{task.detail}</p>}
              </div>
              <ActionForm action={resolveTaskAction.bind(null, task.id)} className="flex items-start gap-2">
                <Input name="resolution" placeholder="Resolution (required)" className="w-56" required />
                <SubmitButton variant="secondary">Resolve</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

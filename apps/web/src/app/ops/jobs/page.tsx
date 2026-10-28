import { JOBS, today } from "@cod/core";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, PageHeader, Select } from "@/components/ui";
import { runJobAction } from "../actions";

export const metadata = { title: "Ops · Jobs" };

const SCHEDULE: Record<string, string> = {
  "send-election-notices": "Hourly",
  "close-election-windows": "Daily",
  "initial-premium-check": "Daily",
  "generate-invoices": "Daily (creates on the 1st)",
  "grace-period-check": "Daily",
  "max-coverage-check": "Daily",
  "employer-billing": "Monthly (1st)",
};

export default function Jobs() {
  return (
    <>
      <PageHeader title="Scheduled jobs" subtitle={`Cloud Scheduler calls POST /api/jobs/{name} with the CRON_SECRET. Every job is idempotent. Today is ${today()}${process.env.COD_TODAY ? " (COD_TODAY override)" : ""}.`} />
      <Card>
        <ul className="mb-6 space-y-1 text-sm text-ink-soft">
          {Object.keys(JOBS).map((j) => <li key={j}><code className="text-ink">{j}</code> · {SCHEDULE[j]}</li>)}
        </ul>
        <ActionForm action={runJobAction} className="flex flex-wrap items-end gap-3">
          <Select name="job" className="w-auto">
            <option value="all">All jobs</option>
            {Object.keys(JOBS).map((j) => <option key={j} value={j}>{j}</option>)}
          </Select>
          <SubmitButton>Run now</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

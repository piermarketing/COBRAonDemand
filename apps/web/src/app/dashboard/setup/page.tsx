import Link from "next/link";
import { setupOverview } from "@cod/core";
import type { SetupModule } from "@cod/db";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { requireEmployer } from "@/lib/auth";
import { dateTime, humanize } from "@/lib/format";
import { GoLiveButton } from "./go-live";
import { MODULE_INFO } from "./modules";

export const metadata = { title: "Setup" };

const STATUS_TONE = { not_started: "neutral", in_progress: "brand", needs_review: "warn", complete: "ok" } as const;

export default async function SetupHub() {
  const { company } = await requireEmployer();
  const overview = await setupOverview(company.id);
  const order = Object.keys(MODULE_INFO) as SetupModule[];
  return (
    <>
      <PageHeader
        title="Setup"
        subtitle="Each module asks where its data should come from. A platform you connect once can fill the rest."
        action={company.status === "onboarding" ? <GoLiveButton disabled={!overview.canGoLive} /> : <Badge tone="ok">Live since {dateTime(company.liveAt)}</Badge>}
      />
      {company.status === "onboarding" && overview.missing.length > 0 && (
        <div className="mb-6">
          <Alert tone="warn" title="Before you can go live">
            Complete: {overview.missing.map((m) => MODULE_INFO[m].title).join(", ")}.
          </Alert>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {order
          .filter((m) => m !== "review")
          .map((m) => {
            const row = overview.modules[m];
            const status = row?.status ?? "not_started";
            return (
              <Link key={m} href={`/dashboard/setup/${m}`} className="block rounded-lg border border-line bg-white p-5 transition hover:border-brand/50">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-ink">{MODULE_INFO[m].title}</h2>
                  <Badge tone={STATUS_TONE[status]}>{humanize(status)}</Badge>
                </div>
                <p className="mt-2 text-sm text-ink-soft">{MODULE_INFO[m].body}</p>
                <p className="mt-3 text-xs text-ink-muted">
                  {row?.sourceType ? `Source: ${humanize(row.sourceType)}` : MODULE_INFO[m].required === false ? "Optional, defaults apply" : MODULE_INFO[m].required === "conditional" ? "Only if you have current enrollees" : "Required"}
                  {row?.lastSyncedAt ? ` · synced ${dateTime(row.lastSyncedAt)}` : ""}
                </p>
              </Link>
            );
          })}
      </div>
    </>
  );
}

import { redirect } from "next/navigation";
import { getEnrolleeView } from "@cod/core";
import type { NoticeDoc } from "@/components/notice-view";
import { requireEnrollee } from "@/lib/auth";
import { ElectionWizard } from "./wizard";

export const metadata = { title: "Your COBRA election" };

export default async function ElectPage({ params }: { params: Promise<{ company: string }> }) {
  const { company: slug } = await params;
  const { session } = await requireEnrollee(slug);
  const view = await getEnrolleeView(session.qbId);
  if (!["notice_sent", "waived"].includes(view.me.status)) redirect(`/e/${slug}/account`);

  const packet = (view.notice?.packet ?? { documents: [] }) as { documents: NoticeDoc[] };
  const docs = packet.documents ?? [];
  const pick = (ids: string[]) => docs.filter((d) => ids.includes(d.id));

  return (
    <ElectionWizard
      slug={slug}
      today={view.today}
      state={view.company.state}
      noticeId={view.notice?.id ?? null}
      acknowledged={Boolean(view.me.noticeAcknowledgedAt)}
      deadline={view.me.electionDeadline!}
      me={{ id: view.me.id, firstName: view.me.firstName }}
      people={view.manageable
        .filter((q) => ["notice_sent", "waived"].includes(q.status))
        .map((q) => ({ id: q.id, name: `${q.firstName} ${q.lastName}`, relationship: q.relationship, deadline: q.electionDeadline }))}
      plans={view.plans.map((p) => ({ planId: p.planId, name: p.name, carrier: p.carrier, type: p.type, originalTier: p.originalTier, rates: p.rates, coveredQbIds: p.coveredQbIds }))}
      noticeDocs={pick(["cover_letter", "election_notice", "rate_sheet", "extension_rights", "ca_extension_ab1401", "separate_notice"])}
      stateDocs={pick(["ca_continuation_2800_2", "ca_hipp_2807", "marketplace"])}
    />
  );
}

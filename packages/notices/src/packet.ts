import { STATES } from "@cod/rules";
import {
  caContinuationNotice,
  caExtensionNotice,
  caHippNotice,
  coverLetter,
  electionForm,
  electionNotice,
  extensionRights,
  marketplaceInfo,
  rateSheet,
  separateNotice,
  unavailabilityNotice,
} from "./templates";
import type { NoticeDocument, Packet, PacketContext } from "./types";

/**
 * Assemble a packet following the "Packet contents checklist": nine items
 * always, plus the extension notice, the unavailability notice and the
 * separate-address notice when they apply. Proof of mailing (item 12) is
 * written by the delivery step, not here.
 */
export function buildPacket(ctx: PacketContext): Packet {
  if (ctx.unavailableReason) {
    return {
      kind: "unavailability",
      noticeDate: ctx.noticeDate,
      addressee: ctx.addressee,
      enrolleeUrl: ctx.enrolleeUrl,
      documents: [unavailabilityNotice(ctx)],
    };
  }

  const stateNotices = STATES[ctx.employer.state]?.packetNotices ?? [];
  const documents: NoticeDocument[] = [coverLetter(ctx), electionNotice(ctx), electionForm(ctx), rateSheet(ctx)];
  if (stateNotices.includes("ca_continuation_2800_2")) documents.push(caContinuationNotice(ctx));
  if (stateNotices.includes("ca_hipp_2807")) documents.push(caHippNotice());
  documents.push(marketplaceInfo(ctx));
  if (ctx.stateExtensionApplies && ctx.plans.some((p) => p.insured)) documents.push(caExtensionNotice());
  documents.push(extensionRights());
  if (ctx.separateNoticeTo?.length) documents.push(separateNotice(ctx.separateNoticeTo));

  return { kind: "election", noticeDate: ctx.noticeDate, addressee: ctx.addressee, enrolleeUrl: ctx.enrolleeUrl, documents };
}

/** Template versions used in a packet, stored with the notice record (NOT-2). */
export function packetTemplateVersions(packet: Packet): Record<string, string> {
  return Object.fromEntries(packet.documents.map((d) => [d.id, d.templateVersion]));
}

/** Plain text rendering for email bodies and search. */
export function packetToText(packet: Packet): string {
  return packet.documents
    .map((d) =>
      [
        d.title.toUpperCase(),
        ...d.sections.flatMap((s) => [
          s.heading ?? "",
          ...(s.paragraphs ?? []),
          ...(s.callout ? [s.callout] : []),
          ...(s.bullets ?? []).map((b) => `• ${b}`),
          ...(s.table ? [s.table.headers.join(" | "), ...s.table.rows.map((r) => r.join(" | "))] : []),
        ]),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

import { describe, expect, it } from "vitest";
import { buildPacket, CA_EXAMINE_OPTIONS_STATEMENT, packetTemplateVersions, packetToText, renderPacketPdf, sha256Hex, type PacketContext } from "./index";

const ctx: PacketContext = {
  noticeDate: "2026-10-28",
  language: "en",
  employer: { name: "Harbor Demo Manufacturing, Inc.", addressLines: ["100 Ocean Blvd", "Long Beach, CA 90802"], phone: "562-555-0100", state: "CA" },
  administrator: { name: "COBRA on Demand", addressLines: ["PO Box 0000", "Long Beach, CA 90802"], phone: "800-555-0199", email: "help@cobraondemand.com", website: "cobraondemand.com" },
  planName: "Harbor Demo Health and Welfare Plan",
  event: { type: "termination", eventDate: "2026-10-20", lossOfCoverageDate: "2026-11-01", cobraStart: "2026-11-01" },
  addressee: { name: "Avery Chen", addressLines: ["12 Shoreline Dr", "Long Beach, CA 90802"], email: "avery.chen@example.com" },
  beneficiaries: [
    { name: "Avery Chen", relationship: "employee", maxCoverageEnd: "2028-04-30" },
    { name: "Riley Chen", relationship: "spouse", maxCoverageEnd: "2028-04-30" },
  ],
  plans: [
    { name: "Gold PPO 500", carrier: "Sample Health Co", type: "medical", currentTier: "Family", monthlyPremium: 185_000, rates: [{ tier: "Employee only", monthly: 65_000 }, { tier: "Family", monthly: 185_000 }], insured: true },
  ],
  electionDeadline: "2026-12-31",
  initialPremiumDays: 45,
  graceDays: 30,
  enrolleeUrl: "https://harbor-demo.cobraondemand.com",
  stateExtensionApplies: true,
};

describe("packet assembly", () => {
  it("includes every always-required document for a California packet, in order", () => {
    const p = buildPacket(ctx);
    expect(p.kind).toBe("election");
    expect(p.documents.map((d) => d.id)).toEqual([
      "cover_letter",
      "election_notice",
      "election_form",
      "rate_sheet",
      "ca_continuation_2800_2",
      "ca_hipp_2807",
      "marketplace",
      "ca_extension_ab1401",
      "extension_rights",
    ]);
  });

  it("carries the exact Labor Code 2800.2 statement", () => {
    expect(packetToText(buildPacket(ctx))).toContain(CA_EXAMINE_OPTIONS_STATEMENT);
  });

  it("omits California documents for other states and the extension when not insured", () => {
    const p = buildPacket({ ...ctx, employer: { ...ctx.employer, state: "TX" }, stateExtensionApplies: false });
    const ids = p.documents.map((d) => d.id);
    expect(ids).not.toContain("ca_hipp_2807");
    expect(ids).not.toContain("ca_extension_ab1401");
  });

  it("adds the separate-address notice", () => {
    const p = buildPacket({ ...ctx, separateNoticeTo: ["Morgan Patel"] });
    expect(p.documents.at(-1)?.id).toBe("separate_notice");
  });

  it("sends only a notice of unavailability when not eligible", () => {
    const p = buildPacket({ ...ctx, unavailableReason: "Not enrolled in a COBRA-eligible plan on the day before coverage ended." });
    expect(p.kind).toBe("unavailability");
    expect(p.documents.map((d) => d.id)).toEqual(["unavailability"]);
  });

  it("states the election deadline and each beneficiary's end date", () => {
    const text = packetToText(buildPacket(ctx));
    expect(text).toContain("December 31, 2026");
    expect(text).toContain("Riley Chen | Spouse | April 30, 2028");
    expect(text).toContain("$1,850.00");
  });

  it("records template versions", () => {
    expect(packetTemplateVersions(buildPacket(ctx)).election_notice).toMatch(/^election-/);
  });
});

describe("pdf rendering", () => {
  it("renders a PDF with a content hash", async () => {
    const a = await renderPacketPdf(buildPacket(ctx), { administratorName: "COBRA on Demand" });
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe("%PDF-");
    expect(a.byteLength).toBeGreaterThan(5_000);
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

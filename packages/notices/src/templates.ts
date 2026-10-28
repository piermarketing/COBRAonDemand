import { EVENT_LABELS, formatCents, parseIsoDate, type IsoDate } from "@cod/rules";
import type { NoticeDocument, PacketContext, Section } from "./types";

/**
 * Notice templates (NOT-1, NOT-2). Each template carries a version so the
 * notices table can prove exactly which text was sent. Text follows the
 * required content of 29 CFR 2590.606-4 and the DOL model election notice,
 * condensed. DRAFT: ERISA counsel must review before go-live.
 */

export const TEMPLATE_VERSIONS = {
  cover_letter: "cover-2026.10.1",
  election_notice: "election-2026.10.1",
  election_form: "election-form-2026.10.1",
  rate_sheet: "rates-2026.10.1",
  ca_continuation_2800_2: "ca-2800.2-2026.10.1",
  ca_hipp_2807: "ca-hipp-2026.10.1",
  marketplace: "marketplace-2026.10.1",
  ca_extension_ab1401: "ca-ab1401-2026.10.1",
  extension_rights: "extension-rights-2026.10.1",
  unavailability: "unavailability-2026.10.1",
  separate_notice: "separate-notice-2026.10.1",
  proof_of_mailing: "proof-2026.10.1",
  general_notice: "general-2026.10.1",
  premium_due: "premium-due-2026.10.1",
  shortfall_cure: "shortfall-2026.10.1",
  grace_warning: "grace-warning-2026.10.1",
  early_termination: "early-termination-2026.10.1",
  coverage_ending: "coverage-ending-2026.10.1",
} as const;
export type TemplateId = keyof typeof TEMPLATE_VERSIONS;

/** The exact statement Labor Code 2800.2 requires. */
export const CA_EXAMINE_OPTIONS_STATEMENT = "Please examine your options carefully before declining this coverage.";

export function formatDate(date: IsoDate): string {
  return parseIsoDate(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const RELATIONSHIP_LABEL = { employee: "Employee", spouse: "Spouse", child: "Child" } as const;

function doc(id: TemplateId, title: string, rule: string, sections: Section[]): NoticeDocument {
  return { id, title, templateVersion: TEMPLATE_VERSIONS[id], rule, sections };
}

export function coverLetter(ctx: PacketContext): NoticeDocument {
  return doc("cover_letter", "Important information about your health coverage", "Best practice", [
    {
      paragraphs: [
        formatDate(ctx.noticeDate),
        [ctx.addressee.name, ...ctx.addressee.addressLines].join("\n"),
        `Your coverage under the ${ctx.planName} sponsored by ${ctx.employer.name} ends because of: ${EVENT_LABELS[ctx.event.type].toLowerCase()} on ${formatDate(ctx.event.eventDate)}. You and your covered family members can keep this coverage through COBRA continuation.`,
      ],
      callout: `Election deadline: ${formatDate(ctx.electionDeadline)}. If you do not elect by this date, you lose your right to COBRA coverage.`,
    },
    {
      heading: "What to do",
      bullets: [
        `Go to ${ctx.enrolleeUrl} (or scan the QR code) and verify your identity.`,
        "Review the plans and monthly costs, then elect or waive for each person.",
        `Pay your first premium within ${ctx.initialPremiumDays} days of electing. It covers every month back to ${formatDate(ctx.event.cobraStart)}.`,
        "If you elect within the deadline and pay on time, coverage is retroactive to the day it ended, with no gap.",
      ],
    },
    {
      heading: "Questions",
      paragraphs: [`${ctx.administrator.name}: ${[ctx.administrator.phone, ctx.administrator.email, ctx.administrator.website].filter(Boolean).join(" · ")}`],
    },
  ]);
}

export function electionNotice(ctx: PacketContext): NoticeDocument {
  const sections: Section[] = [
    {
      paragraphs: [
        `This notice has important information about your right to continue your health care coverage in the ${ctx.planName} (the Plan), and other options that may be available to you. Read it carefully.`,
      ],
      callout: `To elect COBRA continuation coverage, follow the instructions below by ${formatDate(ctx.electionDeadline)}.`,
    },
    {
      heading: "Why you are getting this notice",
      paragraphs: [
        `You are getting this notice because your coverage under the Plan will end on ${formatDate(ctx.event.lossOfCoverageDate)} due to: ${EVENT_LABELS[ctx.event.type].toLowerCase()} (${formatDate(ctx.event.eventDate)}).`,
        "Federal law requires most group health plans to give employees and their families the opportunity to continue their health care coverage through COBRA continuation coverage when there is a qualifying event that would result in a loss of coverage.",
      ],
    },
    {
      heading: "Who can elect, and for how long",
      paragraphs: [
        "Each person listed below is a qualified beneficiary and has an independent right to elect COBRA continuation coverage. A covered employee or spouse may elect on behalf of the others, and a parent or legal guardian may elect for a minor child.",
      ],
      table: {
        headers: ["Qualified beneficiary", "Relationship", "Coverage may continue through"],
        rows: ctx.beneficiaries.map((b) => [b.name, RELATIONSHIP_LABEL[b.relationship], formatDate(b.maxCoverageEnd)]),
      },
    },
    {
      heading: "Coverage you can continue",
      paragraphs: [
        `If elected, COBRA continuation coverage will begin on ${formatDate(ctx.event.cobraStart)} and is the same coverage the Plan gives similarly situated active employees and their families.`,
      ],
      table: {
        headers: ["Plan", "Carrier", "Coverage level", "Monthly cost"],
        rows: ctx.plans.map((p) => [p.name, p.carrier, p.currentTier, formatCents(p.monthlyPremium)]),
      },
    },
    {
      heading: "How much it costs",
      paragraphs: [
        "The monthly premiums above are 100% of the total cost of the coverage (what you and your employer together paid). The law allows the Plan to charge up to 102%; no administrative fee is added.",
        ...(ctx.subsidy
          ? [`${ctx.employer.name} will pay ${ctx.subsidy.percent}% of your premium for the first ${ctx.subsidy.months} month(s). Your invoices will show the employer share and your share.`]
          : []),
      ],
    },
    {
      heading: "How and when to elect",
      bullets: [
        `Elect online at ${ctx.enrolleeUrl} no later than ${formatDate(ctx.electionDeadline)}, or complete the enclosed election form.`,
        "If you do not elect by the deadline, you will lose your right to elect COBRA continuation coverage.",
        "If you waive coverage now, you can revoke the waiver and elect at any time before the deadline. Coverage then starts on the date you revoke the waiver.",
      ],
    },
    {
      heading: "When and how to pay",
      bullets: [
        `Your first payment is due no later than ${ctx.initialPremiumDays} days after the date of your election. It must cover every month from ${formatDate(ctx.event.cobraStart)} through the month you pay.`,
        `After that, premiums are due on the first day of each month. There is a ${ctx.graceDays}-day grace period for each monthly payment.`,
        "If a payment is short by an amount that is not significant (no more than the lesser of $50 or 10% of the amount due), we will tell you and give you 30 days to pay the difference.",
        `Pay online at ${ctx.enrolleeUrl} by bank transfer (ACH) or card, with optional autopay. There is no card convenience fee.`,
        "If you do not pay a premium in full by the end of its grace period, COBRA coverage will end and cannot be reinstated.",
      ],
    },
    {
      heading: "When COBRA coverage can end early",
      bullets: [
        "Premiums are not paid in full on time.",
        "The employer stops offering group health coverage to any employee.",
        "A qualified beneficiary becomes covered under another group health plan after electing COBRA.",
        "A qualified beneficiary becomes entitled to Medicare after electing COBRA.",
        "Any reason the Plan would terminate coverage of a participant who is not receiving continuation coverage (such as fraud).",
      ],
    },
    {
      heading: "Keep us informed",
      paragraphs: [
        `Tell ${ctx.administrator.name} right away about any change of address for you or your family members, a divorce or legal separation, a dependent child losing dependent status, a Social Security disability determination, or Medicare entitlement.`,
      ],
    },
    {
      heading: "Plan contact information",
      paragraphs: [
        `Plan sponsor: ${ctx.employer.name}, ${ctx.employer.addressLines.join(", ")}${ctx.employer.phone ? `, ${ctx.employer.phone}` : ""}`,
        `COBRA administrator: ${ctx.administrator.name}, ${ctx.administrator.addressLines.join(", ")}${ctx.administrator.phone ? `, ${ctx.administrator.phone}` : ""}`,
        "For more information about your rights under ERISA, including COBRA, the Patient Protection and Affordable Care Act, and other laws affecting group health plans, visit the U.S. Department of Labor's Employee Benefits Security Administration (EBSA) website at www.dol.gov/ebsa or call 1-866-444-3272.",
      ],
    },
  ];
  return doc("election_notice", "COBRA continuation coverage election notice", "29 CFR 2590.606-4", sections);
}

export function electionForm(ctx: PacketContext): NoticeDocument {
  return doc("election_form", "COBRA election form", "29 CFR 2590.606-4", [
    {
      paragraphs: [
        `Return by ${formatDate(ctx.electionDeadline)}, or elect online at ${ctx.enrolleeUrl}. Electing online is faster and gives you a confirmation number.`,
        "For each person and each plan, mark ELECT or WAIVE. Each qualified beneficiary may decide differently.",
      ],
      table: {
        headers: ["Person", "Plan", "Elect", "Waive"],
        rows: ctx.beneficiaries.flatMap((b) => ctx.plans.map((p) => [b.name, p.name, "[  ]", "[  ]"])),
      },
    },
    {
      heading: "Waiver revocation",
      paragraphs: ["If you waive now, you may revoke your waiver and elect coverage at any time before the deadline above by contacting the administrator or electing online."],
    },
    { heading: "Signature", paragraphs: ["Signature: ______________________________   Date: ______________", "Printed name: ______________________________   Phone: ______________"] },
  ]);
}

export function rateSheet(ctx: PacketContext): NoticeDocument {
  const tierHeaders = Array.from(new Set(ctx.plans.flatMap((p) => p.rates.map((r) => r.tier))));
  return doc("rate_sheet", "Premium rates and payment schedule", "29 CFR 2590.606-4", [
    {
      paragraphs: ["Monthly COBRA premiums at 100% of the total plan cost. No administrative fee or surcharge is added."],
      table: {
        headers: ["Plan", ...tierHeaders],
        rows: ctx.plans.map((p) => [p.name, ...tierHeaders.map((t) => {
          const r = p.rates.find((x) => x.tier === t);
          return r ? formatCents(r.monthly) : "—";
        })]),
      },
    },
    {
      heading: "Payment schedule",
      bullets: [
        `First payment: within ${ctx.initialPremiumDays} days after you elect, covering all months since ${formatDate(ctx.event.cobraStart)}.`,
        `Monthly payments: due on the 1st of each month, with a ${ctx.graceDays}-day grace period.`,
        `Where to pay: ${ctx.enrolleeUrl} (ACH or card, autopay available).`,
      ],
    },
  ]);
}

export function caContinuationNotice(ctx: PacketContext): NoticeDocument {
  return doc("ca_continuation_2800_2", "California notice of continuation coverage", "Labor Code 2800.2", [
    {
      paragraphs: [
        "Under California law you and your covered spouse or dependents may have the right to continue health coverage, and you may have other coverage options, including Covered California.",
        ctx.stateExtensionApplies
          ? "If your federal COBRA coverage runs out before 36 months, California law (Cal-COBRA) may let you continue coverage through your insurance carrier until 36 months from the date COBRA began."
          : "Ask the administrator whether any California continuation rights apply to your plan.",
      ],
      callout: CA_EXAMINE_OPTIONS_STATEMENT,
    },
  ]);
}

export function caHippNotice(): NoticeDocument {
  return doc("ca_hipp_2807", "Health Insurance Premium Payment (HIPP) program", "Labor Code 2807", [
    {
      paragraphs: [
        "The Medi-Cal Health Insurance Premium Payment (HIPP) program may pay COBRA premiums for eligible people with a high-cost medical condition.",
        "[Insert the standardized HIPP description published by the California Department of Health Care Services, verbatim, before go-live.]",
      ],
    },
  ]);
}

export function marketplaceInfo(ctx: PacketContext): NoticeDocument {
  return doc("marketplace", "Other coverage options: Marketplace and Medicare", "DOL model election notice", [
    {
      heading: "Health Insurance Marketplace",
      paragraphs: [
        `Instead of COBRA, you may be able to buy coverage through the Health Insurance Marketplace${ctx.employer.state === "CA" ? " (Covered California, www.coveredca.com)" : " (www.healthcare.gov)"} and may qualify for lower costs on monthly premiums and out-of-pocket costs.`,
        "Losing your employer coverage opens a 60-day special enrollment period in the Marketplace. If you elect COBRA and later drop it voluntarily or stop paying, you will not get a new special enrollment period outside the Marketplace's open enrollment.",
        "You may also qualify for a special enrollment period in another group health plan (such as a spouse's plan) if you request it within 30 days of losing coverage.",
      ],
    },
    {
      heading: "If you are eligible for Medicare",
      paragraphs: [
        "If you are eligible for Medicare, you have an 8-month special enrollment period to sign up for Medicare Part A or B, beginning the earlier of the month after your employment ends or the month after group coverage based on current employment ends.",
        "COBRA does not extend this period. If you don't enroll in Medicare and choose COBRA instead, you may have to pay a Part B late enrollment penalty and may have a gap in coverage.",
      ],
    },
  ]);
}

export function extensionRights(): NoticeDocument {
  return doc("extension_rights", "Extending your COBRA coverage", "29 CFR 2590.606-3", [
    {
      heading: "Disability extension (11 more months)",
      paragraphs: [
        "If anyone in your family is determined by the Social Security Administration to be disabled at any time during the first 60 days of COBRA, every qualified beneficiary may get up to 11 more months (29 total). Notify us within 60 days of the SSA determination and before the 18-month period ends. Premiums for months 19–29 may be up to 150% of plan cost.",
      ],
    },
    {
      heading: "Second qualifying event (up to 36 months)",
      paragraphs: [
        "If a second event happens during the 18 months (the employee's death, divorce or legal separation, Medicare entitlement, or a child losing dependent status), the spouse and children may get up to 36 months in total. Notify us within 60 days of the second event.",
      ],
    },
  ]);
}

export function caExtensionNotice(): NoticeDocument {
  return doc("ca_extension_ab1401", "Cal-COBRA extension to 36 months", "CA AB 1401", [
    {
      paragraphs: [
        "If your plan is insured in California and your federal COBRA ends after 18 or 29 months, you may be able to continue coverage through Cal-COBRA, administered by your carrier, until 36 months after your COBRA began. Self-funded plans and stand-alone dental or vision plans are not included.",
        "Your carrier will send you an extension notice before your federal COBRA ends. Cal-COBRA premiums may be up to 110% of the group rate (150% during a disability extension).",
      ],
    },
  ]);
}

export function separateNotice(names: string[]): NoticeDocument {
  return doc("separate_notice", "Separate notices to family members", "DOL guidance", [
    { paragraphs: [`A separate copy of this notice has been sent to ${names.join(", ")} at their own address.`] },
  ]);
}

export function unavailabilityNotice(ctx: PacketContext): NoticeDocument {
  return doc("unavailability", "Notice of unavailability of COBRA continuation coverage", "29 CFR 2590.606-4(c)", [
    {
      paragraphs: [
        `We received a notice of a qualifying event for coverage under the ${ctx.planName}. After review, COBRA continuation coverage is not available.`,
        `Reason: ${ctx.unavailableReason ?? "Not eligible."}`,
        `If you believe this is wrong, contact ${ctx.administrator.name} at ${ctx.administrator.phone ?? ctx.administrator.email ?? ""}.`,
      ],
    },
  ]);
}

export function proofOfMailing(ctx: PacketContext, channel: string, trackingId?: string): NoticeDocument {
  return doc("proof_of_mailing", "Delivery record", "Proof of delivery", [
    {
      bullets: [
        `Notice date: ${formatDate(ctx.noticeDate)}`,
        `Delivered to: ${ctx.addressee.name}`,
        `Channel: ${channel}`,
        ...(trackingId ? [`Tracking: ${trackingId}`] : []),
      ],
    },
  ]);
}

/** Lifecycle notices sent after the election packet. */
export function simpleNotice(id: Exclude<TemplateId, "cover_letter" | "election_notice" | "election_form" | "rate_sheet">, title: string, rule: string, paragraphs: string[]): NoticeDocument {
  return doc(id, title, rule, [{ paragraphs }]);
}

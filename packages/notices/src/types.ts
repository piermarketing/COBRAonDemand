import type { IsoDate, QualifyingEventType, Relationship } from "@cod/rules";

export interface Party {
  name: string;
  addressLines: string[];
  phone?: string;
  email?: string;
  website?: string;
}

export interface NoticeBeneficiary {
  name: string;
  relationship: Relationship;
  maxCoverageEnd: IsoDate;
}

export interface NoticePlan {
  name: string;
  carrier: string;
  type: string;
  /** Tier on the last day of coverage (preselected in the portal). */
  currentTier: string;
  /** Monthly COBRA premium for the current tier, in cents. */
  monthlyPremium: number;
  /** All tiers with their monthly COBRA premium, in cents. */
  rates: { tier: string; monthly: number }[];
  /** What the person paid as an active employee per month, when known. */
  activeEmployeeCost?: number;
  insured: boolean;
}

export interface PacketContext {
  noticeDate: IsoDate;
  language: "en" | "es";
  employer: Party & { state: string; hrContact?: string };
  administrator: Party;
  planName: string;
  event: {
    type: QualifyingEventType;
    eventDate: IsoDate;
    lossOfCoverageDate: IsoDate;
    cobraStart: IsoDate;
  };
  /** Addressee of this packet. */
  addressee: { name: string; addressLines: string[]; email?: string };
  /** Qualified beneficiaries at this address, each with their own right to elect. */
  beneficiaries: NoticeBeneficiary[];
  plans: NoticePlan[];
  electionDeadline: IsoDate;
  initialPremiumDays: number;
  graceDays: number;
  enrolleeUrl: string;
  /** Present when the person isn't eligible: sends a notice of unavailability instead. */
  unavailableReason?: string;
  /** CA AB 1401: describe the carrier-run extension to 36 months. */
  stateExtensionApplies: boolean;
  /** Employer-paid months, when the employer subsidizes COBRA. */
  subsidy?: { months: number; percent: number };
  /** Set when other people covered on the plan live at another address and get their own packet. */
  separateNoticeTo?: string[];
}

export interface Section {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  /** Emphasized text (e.g. the election deadline). */
  callout?: string;
}

export interface NoticeDocument {
  id: string;
  title: string;
  templateVersion: string;
  /** Legal basis or rule this document satisfies. */
  rule: string;
  sections: Section[];
}

export interface Packet {
  kind: "election" | "unavailability";
  noticeDate: IsoDate;
  addressee: PacketContext["addressee"];
  documents: NoticeDocument[];
  enrolleeUrl: string;
}

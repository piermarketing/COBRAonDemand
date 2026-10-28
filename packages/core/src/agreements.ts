import { createHash } from "node:crypto";
import { ADMINISTRATOR } from "./env";

/**
 * Clickwrap agreements accepted at sign-up before any data syncs (ONB-6).
 * DRAFT summaries of the required terms; replace with counsel-approved text.
 * Changing the text requires a new version, which forces re-acceptance.
 */

export interface AgreementText {
  type: "terms_of_service" | "service_agreement" | "baa";
  version: string;
  title: string;
  body: string[];
}

export const AGREEMENTS: AgreementText[] = [
  {
    type: "terms_of_service",
    version: "tos-2026.10-draft",
    title: "Terms and Conditions",
    body: [
      "These Terms govern use of COBRA on Demand. The Service Agreement and the HIPAA Business Associate Agreement below are part of these Terms.",
      "Fees are billed to the employer (or its broker) as a flat rate per COBRA packet sent plus the same rate per active COBRA enrollee per month. No charge is made until the first packet is sent.",
      `Administrator: ${ADMINISTRATOR.name}, California Administrator Certificate No. ${ADMINISTRATOR.caAdministratorCertificate}.`,
    ],
  },
  {
    type: "service_agreement",
    version: "svc-2026.10-draft",
    title: "COBRA Administration Service Agreement",
    body: [
      "The employer appoints COBRA on Demand as COBRA administrator for its group health plans. COBRA on Demand sends election, payment, early termination and coverage-ending notices; the employer remains responsible for reporting qualifying events within 30 days, which the connected data source does automatically.",
      "Administration is electronic-only. The employer will tell all covered employees that COBRA is administered electronically and will roll out the electronic-delivery consent request. Notices to people without consent are mailed automatically, and a manual administration fee per participant per month is billed to the employer. That fee may not be passed on to employees or beneficiaries.",
      "Enrollees are billed 100% of the total plan cost. No administrative fee, percentage or surcharge is added to enrollee premiums.",
      "Premiums are collected into a trust account held by COBRA on Demand and remitted monthly with a remittance report.",
      "Records are kept for the term of the agreement plus five years (Cal. Ins. Code 1759), and at least six years for ERISA purposes.",
    ],
  },
  {
    type: "baa",
    version: "baa-2026.10-draft",
    title: "HIPAA Business Associate Agreement",
    body: [
      "COBRA on Demand will use and disclose protected health information only to administer COBRA for the plan, will apply administrative, physical and technical safeguards, will report any breach without unreasonable delay, and will flow these obligations down to its subcontractors under their own business associate agreements.",
    ],
  },
];

export function agreementHash(a: AgreementText): string {
  return createHash("sha256").update(`${a.version}\n${a.title}\n${a.body.join("\n")}`).digest("hex");
}

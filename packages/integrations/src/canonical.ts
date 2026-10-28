import type { IsoDate, PlanType, Relationship, Tier } from "@cod/rules";
export { TIERS, TIER_LABELS, type Tier } from "@cod/rules";

/**
 * Canonical data model. Every source (payroll, ben-admin, HRIS, census file,
 * manual entry) maps into these shapes so the COBRA engine never knows which
 * vendor the data came from.
 */

export type SourceType = "payroll" | "ben_admin" | "hr_platform" | "census_upload" | "carrier_document" | "broker" | "manual";

export interface CanonicalEmployer {
  legalName: string;
  ein?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  planYearStart?: IsoDate;
  priorYearEmployeeCount?: number;
}

export interface CanonicalAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
}

export type EmploymentStatus = "active" | "terminated" | "leave";

export interface CanonicalEmployee {
  sourceId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: IsoDate;
  /** Full SSN only when a carrier needs it; stored encrypted. */
  ssn?: string;
  ssnLast4: string;
  address: CanonicalAddress;
  personalEmail?: string;
  phone?: string;
  status: EmploymentStatus;
  hireDate: IsoDate;
  terminationDate?: IsoDate;
  terminationReason?: string;
  /** Scheduled weekly hours; a drop can trigger a reduction-in-hours event. */
  weeklyHours?: number;
  benefitsEligible?: boolean;
}

export interface CanonicalDependent {
  sourceId: string;
  employeeSourceId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: IsoDate;
  relationship: Exclude<Relationship, "employee">;
  address?: CanonicalAddress;
  email?: string;
}

export interface CanonicalPlan {
  sourceId: string;
  carrier: string;
  name: string;
  type: PlanType;
  groupNumber?: string;
  planYearStart?: IsoDate;
  insured: boolean;
  /** Total monthly premium per tier (employer + employee share), in cents. */
  ratesByTier: Partial<Record<Tier, number>>;
}

export interface CanonicalEnrollment {
  personSourceId: string;
  /** Employee who carries the coverage. */
  employeeSourceId: string;
  planSourceId: string;
  tier: Tier;
  effectiveDate: IsoDate;
  endDate?: IsoDate;
}

export interface CanonicalSnapshot {
  takenAt: string;
  employer?: CanonicalEmployer;
  employees: CanonicalEmployee[];
  dependents: CanonicalDependent[];
  plans: CanonicalPlan[];
  enrollments: CanonicalEnrollment[];
}

export type DetectedEventKind = "termination" | "reduction_in_hours" | "dependent_removed" | "termination_cancelled" | "rehire";

export interface DetectedEvent {
  kind: DetectedEventKind;
  employeeSourceId: string;
  dependentSourceId?: string;
  eventDate: IsoDate;
  reason?: string;
  detail: string;
}

import { isIsoDate, PLAN_TYPES, TIERS, type IsoDate, type PlanType, type Tier } from "@cod/rules";
import { z } from "zod";
import type {
  CanonicalDependent,
  CanonicalEmployee,
  CanonicalEnrollment,
  CanonicalPlan,
} from "./canonical";
import { parseCsv, toCsv } from "./csv";

/**
 * Census template upload (INT-12 fallback, and the "start now with exports"
 * path for the Employee Navigator pilot). One row per person: the employee row
 * plus a row for each covered spouse or child, linked by employee_id. Plan
 * elections ride on each row so one file fills Employees, Dependents and
 * Current elections.
 */

export const CENSUS_COLUMNS = [
  "employee_id",
  "relationship",
  "first_name",
  "last_name",
  "dob",
  "ssn_last4",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "email",
  "phone",
  "hire_date",
  "status",
  "termination_date",
  "termination_reason",
  "weekly_hours",
  "medical_plan",
  "medical_tier",
  "dental_plan",
  "dental_tier",
  "vision_plan",
  "vision_tier",
] as const;

export const PLAN_COLUMNS = [
  "plan_code",
  "carrier",
  "plan_name",
  "type",
  "group_number",
  "insured",
  "rate_employee",
  "rate_employee_spouse",
  "rate_employee_children",
  "rate_family",
] as const;

const HEADER_ALIASES: Record<string, string> = {
  employeeid: "employee_id",
  empid: "employee_id",
  ee_id: "employee_id",
  rel: "relationship",
  relation: "relationship",
  firstname: "first_name",
  lastname: "last_name",
  dateofbirth: "dob",
  birthdate: "dob",
  ssnlast4: "ssn_last4",
  last4: "ssn_last4",
  ssn: "ssn",
  address: "address1",
  addressline1: "address1",
  street: "address1",
  addressline2: "address2",
  zipcode: "zip",
  postalcode: "zip",
  emailaddress: "email",
  personalemail: "email",
  phonenumber: "phone",
  hiredate: "hire_date",
  termdate: "termination_date",
  terminationdate: "termination_date",
  termreason: "termination_reason",
  terminationreason: "termination_reason",
  hours: "weekly_hours",
  weeklyhours: "weekly_hours",
  plancode: "plan_code",
  planname: "plan_name",
  plantype: "type",
  groupnumber: "group_number",
};

export function normalizeHeader(header: string): string {
  const snake = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const compact = snake.replace(/_/g, "");
  return HEADER_ALIASES[compact] ?? HEADER_ALIASES[snake] ?? snake;
}

/** Accepts YYYY-MM-DD or M/D/YYYY. */
export function normalizeDate(value: string): IsoDate | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (isIsoDate(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const iso = `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
    if (isIsoDate(iso)) return iso;
  }
  return undefined;
}

const TIER_ALIASES: Record<string, Tier> = {
  ee: "employee",
  employee: "employee",
  employee_only: "employee",
  es: "employee_spouse",
  ee_sp: "employee_spouse",
  employee_spouse: "employee_spouse",
  ec: "employee_children",
  ee_ch: "employee_children",
  employee_children: "employee_children",
  employee_child: "employee_children",
  fam: "family",
  family: "family",
};

export function normalizeTier(value: string): Tier | undefined {
  const key = value.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  return TIER_ALIASES[key];
}

export interface RowError {
  row: number;
  column?: string;
  message: string;
}

export interface CensusParseResult {
  employees: CanonicalEmployee[];
  dependents: CanonicalDependent[];
  enrollments: CanonicalEnrollment[];
  /** Plan codes referenced in elections; must match the plans module. */
  referencedPlanCodes: string[];
  errors: RowError[];
  warnings: RowError[];
  rowCount: number;
}

function table(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [headerRow, ...dataRows] = parseCsv(text);
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map(normalizeHeader);
  const rows = dataRows.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

const RELATIONSHIP_ALIASES: Record<string, "employee" | "spouse" | "child"> = {
  employee: "employee",
  ee: "employee",
  self: "employee",
  spouse: "spouse",
  sp: "spouse",
  husband: "spouse",
  wife: "spouse",
  child: "child",
  ch: "child",
  son: "child",
  daughter: "child",
  dependent: "child",
};

export function parseCensusCsv(text: string, opts: { asOf?: IsoDate } = {}): CensusParseResult {
  const { headers, rows } = table(text);
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  const employees: CanonicalEmployee[] = [];
  const dependents: CanonicalDependent[] = [];
  const enrollments: CanonicalEnrollment[] = [];
  const planCodes = new Set<string>();

  for (const required of ["employee_id", "first_name", "last_name", "dob"]) {
    if (!headers.includes(required)) errors.push({ row: 1, column: required, message: `Missing required column "${required}".` });
  }
  if (errors.length) return { employees, dependents, enrollments, referencedPlanCodes: [], errors, warnings, rowCount: rows.length };

  const employeeIds = new Set<string>();
  const depCounters = new Map<string, number>();
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);

  rows.forEach((r, idx) => {
    const rowNum = idx + 2;
    const err = (column: string, message: string) => errors.push({ row: rowNum, column, message });
    const relationship = RELATIONSHIP_ALIASES[(r.relationship || "employee").toLowerCase()];
    if (!relationship) return err("relationship", `Unknown relationship "${r.relationship}". Use employee, spouse or child.`);
    const employeeId = r.employee_id ?? "";
    if (!employeeId) return err("employee_id", "Employee ID is required.");
    const dob = normalizeDate(r.dob ?? "");
    if (!dob) err("dob", "Date of birth must be YYYY-MM-DD or MM/DD/YYYY.");
    if (!r.first_name || !r.last_name) err("first_name", "First and last name are required.");

    const address =
      r.address1 && r.city && r.state && r.zip
        ? { line1: r.address1, line2: r.address2 || undefined, city: r.city, state: r.state.toUpperCase(), postalCode: r.zip }
        : undefined;

    let personSourceId = employeeId;

    if (relationship === "employee") {
      if (employeeIds.has(employeeId)) return err("employee_id", `Duplicate employee ID ${employeeId}.`);
      const ssnDigits = (r.ssn ?? "").replace(/\D/g, "");
      const last4 = (r.ssn_last4 || ssnDigits.slice(-4)).replace(/\D/g, "");
      if (last4.length !== 4) err("ssn_last4", "Last 4 of SSN is required for identity verification.");
      if (!address) err("address1", "A full home address (address1, city, state, zip) is required for notices.");
      const hireDate = normalizeDate(r.hire_date ?? "");
      if (!hireDate) err("hire_date", "Hire date is required.");
      const terminationDate = normalizeDate(r.termination_date ?? "");
      if (r.termination_date && !terminationDate) err("termination_date", "Termination date must be a valid date.");
      const status = terminationDate && terminationDate <= asOf ? "terminated" : ((r.status || "active").toLowerCase() as CanonicalEmployee["status"]);
      if (!["active", "terminated", "leave"].includes(status)) err("status", "Status must be active, terminated or leave.");
      if (!r.email) warnings.push({ row: rowNum, column: "email", message: "No personal email: notices will go by mail unless the employee consents electronically." });
      if (ssnDigits.length > 0 && ssnDigits.length !== 9) err("ssn", "Full SSN must have 9 digits (or leave it blank and use ssn_last4).");
      const hours = r.weekly_hours ? Number(r.weekly_hours) : undefined;
      if (hours !== undefined && Number.isNaN(hours)) err("weekly_hours", "Weekly hours must be a number.");

      if (dob && address && hireDate && last4.length === 4) {
        employees.push({
          sourceId: employeeId,
          firstName: r.first_name!,
          lastName: r.last_name!,
          dateOfBirth: dob,
          ssn: ssnDigits.length === 9 ? ssnDigits : undefined,
          ssnLast4: last4,
          address,
          personalEmail: r.email || undefined,
          phone: r.phone || undefined,
          status,
          hireDate,
          terminationDate,
          terminationReason: r.termination_reason || undefined,
          weeklyHours: hours,
        });
        employeeIds.add(employeeId);
      }
    } else {
      const n = (depCounters.get(employeeId) ?? 0) + 1;
      depCounters.set(employeeId, n);
      personSourceId = `${employeeId}-D${n}`;
      if (dob && r.first_name && r.last_name) {
        dependents.push({
          sourceId: personSourceId,
          employeeSourceId: employeeId,
          firstName: r.first_name,
          lastName: r.last_name,
          dateOfBirth: dob,
          relationship,
          address,
          email: r.email || undefined,
        });
      }
    }

    for (const line of ["medical", "dental", "vision"] as const) {
      const plan = r[`${line}_plan`];
      if (!plan) continue;
      const tier = normalizeTier(r[`${line}_tier`] ?? "");
      if (!tier) {
        err(`${line}_tier`, `Tier for ${line} must be one of ${TIERS.join(", ")} (or EE/ES/EC/FAM).`);
        continue;
      }
      planCodes.add(plan);
      enrollments.push({ personSourceId, employeeSourceId: employeeId, planSourceId: plan, tier, effectiveDate: normalizeDate(r.hire_date ?? "") ?? asOf });
    }
  });

  for (const d of dependents) {
    if (!employeeIds.has(d.employeeSourceId)) {
      errors.push({ row: 0, column: "employee_id", message: `Dependent ${d.firstName} ${d.lastName} references unknown employee ${d.employeeSourceId}.` });
    }
  }

  return { employees, dependents, enrollments, referencedPlanCodes: [...planCodes], errors, warnings, rowCount: rows.length };
}

const planRowSchema = z.object({
  plan_code: z.string().min(1, "Plan code is required."),
  carrier: z.string().min(1, "Carrier is required."),
  plan_name: z.string().min(1, "Plan name is required."),
  type: z.enum(PLAN_TYPES as unknown as [PlanType, ...PlanType[]], { message: `Type must be one of ${PLAN_TYPES.join(", ")}.` }),
});

function dollarsCell(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

export function parsePlansCsv(text: string): { plans: CanonicalPlan[]; errors: RowError[] } {
  const { rows } = table(text);
  const plans: CanonicalPlan[] = [];
  const errors: RowError[] = [];
  rows.forEach((r, idx) => {
    const rowNum = idx + 2;
    const parsed = planRowSchema.safeParse({ ...r, type: (r.type ?? "").toLowerCase() });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push({ row: rowNum, column: String(issue.path[0] ?? ""), message: issue.message });
      return;
    }
    const ratesByTier: CanonicalPlan["ratesByTier"] = {};
    for (const tier of TIERS) {
      const cents = dollarsCell(r[`rate_${tier}`]);
      if (Number.isNaN(cents)) errors.push({ row: rowNum, column: `rate_${tier}`, message: "Rates must be monthly dollar amounts." });
      else if (cents !== undefined) ratesByTier[tier] = cents;
    }
    plans.push({
      sourceId: parsed.data.plan_code,
      carrier: parsed.data.carrier,
      name: parsed.data.plan_name,
      type: parsed.data.type,
      groupNumber: r.group_number || undefined,
      insured: !/^(no|n|false|self|self-funded)$/i.test(r.insured ?? "yes"),
      ratesByTier,
    });
  });
  return { plans, errors };
}

/** Downloadable templates with synthetic sample rows (no real data, GH-7). */
export function censusTemplateCsv(): string {
  return toCsv([
    [...CENSUS_COLUMNS],
    ["1001", "employee", "Jordan", "Rivera", "1985-04-12", "4821", "120 Pine Ave", "", "Long Beach", "CA", "90802", "jordan@example.com", "562-555-0101", "2021-03-01", "active", "", "", "40", "MED-PPO", "ES", "DEN-PPO", "ES", "", ""],
    ["1001", "spouse", "Sam", "Rivera", "1986-09-30", "", "", "", "", "", "", "", "", "", "", "", "", "", "MED-PPO", "ES", "DEN-PPO", "ES", "", ""],
  ]);
}

export function plansTemplateCsv(): string {
  return toCsv([
    [...PLAN_COLUMNS],
    ["MED-PPO", "Sample Health Co", "Gold PPO 500", "medical", "G-12345", "yes", "650.00", "1300.00", "1150.00", "1850.00"],
    ["DEN-PPO", "Sample Dental Co", "Dental PPO", "dental", "D-555", "yes", "42.00", "84.00", "90.00", "130.00"],
  ]);
}

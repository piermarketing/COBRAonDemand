import type {
  CanonicalDependent,
  CanonicalEmployee,
  CanonicalEmployer,
  CanonicalEnrollment,
  CanonicalPlan,
  CanonicalSnapshot,
} from "./canonical";
import type { Connector } from "./connector";

/**
 * Sandbox connector with synthetic data (GH-7: no real employee data in dev).
 * Stands in for Finch / Employee Navigator until partner access is granted,
 * so the full loop (sync → termination detected → packet → election) can be
 * exercised end to end.
 */

const addr = (line1: string) => ({ line1, city: "Long Beach", state: "CA", postalCode: "90802" });

export function sandboxSnapshot(): CanonicalSnapshot {
  const employer: CanonicalEmployer = {
    legalName: "Harbor Demo Manufacturing, Inc.",
    ein: "00-0000000",
    addressLine1: "100 Ocean Blvd",
    city: "Long Beach",
    state: "CA",
    postalCode: "90802",
    phone: "562-555-0100",
    planYearStart: "2026-01-01",
    priorYearEmployeeCount: 42,
  };
  const employees: CanonicalEmployee[] = [
    { sourceId: "E100", firstName: "Avery", lastName: "Chen", dateOfBirth: "1984-02-14", ssnLast4: "1111", address: addr("12 Shoreline Dr"), personalEmail: "avery.chen@example.com", phone: "562-555-0111", status: "active", hireDate: "2019-05-06", weeklyHours: 40 },
    { sourceId: "E101", firstName: "Blake", lastName: "Morgan", dateOfBirth: "1990-07-22", ssnLast4: "2222", address: addr("45 Harbor Way"), personalEmail: "blake.morgan@example.com", status: "active", hireDate: "2021-01-11", weeklyHours: 40 },
    { sourceId: "E102", firstName: "Casey", lastName: "Patel", dateOfBirth: "1978-11-03", ssnLast4: "3333", address: addr("78 Pier Ln"), status: "active", hireDate: "2016-09-19", weeklyHours: 40 },
    { sourceId: "E103", firstName: "Devon", lastName: "Lopez", dateOfBirth: "1995-03-30", ssnLast4: "4444", address: addr("9 Marina Ct"), personalEmail: "devon.lopez@example.com", status: "active", hireDate: "2023-06-01", weeklyHours: 36 },
  ];
  const dependents: CanonicalDependent[] = [
    { sourceId: "E100-D1", employeeSourceId: "E100", firstName: "Riley", lastName: "Chen", dateOfBirth: "1985-08-09", relationship: "spouse" },
    { sourceId: "E100-D2", employeeSourceId: "E100", firstName: "Jamie", lastName: "Chen", dateOfBirth: "2015-04-18", relationship: "child" },
    { sourceId: "E102-D1", employeeSourceId: "E102", firstName: "Morgan", lastName: "Patel", dateOfBirth: "1980-01-25", relationship: "spouse", address: addr("310 Bayview Ave") },
  ];
  const plans: CanonicalPlan[] = [
    { sourceId: "MED-PPO", carrier: "Sample Health Co", name: "Gold PPO 500", type: "medical", groupNumber: "G-12345", insured: true, planYearStart: "2026-01-01", ratesByTier: { employee: 65_000, employee_spouse: 130_000, employee_children: 115_000, family: 185_000 } },
    { sourceId: "MED-HMO", carrier: "Sample Health Co", name: "Silver HMO", type: "medical", groupNumber: "G-12346", insured: true, planYearStart: "2026-01-01", ratesByTier: { employee: 48_000, employee_spouse: 96_000, employee_children: 86_000, family: 138_000 } },
    { sourceId: "DEN-PPO", carrier: "Sample Dental Co", name: "Dental PPO", type: "dental", groupNumber: "D-555", insured: true, planYearStart: "2026-01-01", ratesByTier: { employee: 4_200, employee_spouse: 8_400, employee_children: 9_000, family: 13_000 } },
    { sourceId: "VIS-BASE", carrier: "Sample Vision Co", name: "Vision Plus", type: "vision", groupNumber: "V-777", insured: true, planYearStart: "2026-01-01", ratesByTier: { employee: 900, employee_spouse: 1_800, employee_children: 1_900, family: 2_700 } },
    { sourceId: "LIFE-BASIC", carrier: "Sample Life Co", name: "Basic Life $50k", type: "life", insured: true, planYearStart: "2026-01-01", ratesByTier: { employee: 1_200 } },
  ];
  const enroll = (person: string, employee: string, plan: string, tier: CanonicalEnrollment["tier"]): CanonicalEnrollment => ({
    personSourceId: person,
    employeeSourceId: employee,
    planSourceId: plan,
    tier,
    effectiveDate: "2026-01-01",
  });
  const enrollments: CanonicalEnrollment[] = [
    ...["E100", "E100-D1", "E100-D2"].flatMap((p) => [enroll(p, "E100", "MED-PPO", "family"), enroll(p, "E100", "DEN-PPO", "family")]),
    enroll("E100", "E100", "LIFE-BASIC", "employee"),
    enroll("E101", "E101", "MED-HMO", "employee"),
    enroll("E101", "E101", "VIS-BASE", "employee"),
    ...["E102", "E102-D1"].flatMap((p) => [enroll(p, "E102", "MED-PPO", "employee_spouse"), enroll(p, "E102", "VIS-BASE", "employee_spouse")]),
  ];
  return { takenAt: new Date().toISOString(), employer, employees, dependents, plans, enrollments };
}

export class SandboxConnector implements Connector {
  readonly provider = "sandbox";
  readonly displayName = "Sandbox (synthetic data)";
  readonly sourceType = "payroll" as const;

  constructor(private snapshot: CanonicalSnapshot = sandboxSnapshot()) {}

  async authorize() {
    return { connectionId: `sandbox_${Math.random().toString(36).slice(2, 10)}` };
  }
  async getEmployer() {
    return this.snapshot.employer!;
  }
  async listEmployees() {
    return this.snapshot.employees;
  }
  async getEmployee(id: string) {
    return this.snapshot.employees.find((e) => e.sourceId === id);
  }
  async listDependents() {
    return this.snapshot.dependents;
  }
  async listEnrollments() {
    return this.snapshot.enrollments;
  }
  async listPlans() {
    return this.snapshot.plans;
  }
  async handleWebhook() {
    return [];
  }
  async healthCheck() {
    return { ok: true };
  }
}

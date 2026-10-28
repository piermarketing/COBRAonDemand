import { describe, expect, it } from "vitest";
import {
  censusTemplateCsv,
  deriveMonthlyPremium,
  detectEvents,
  matchKey,
  mergeEmployees,
  normalizeDate,
  normalizeHeader,
  parseCensusCsv,
  parseCsv,
  parsePlansCsv,
  plansTemplateCsv,
  sandboxSnapshot,
  signWebhook,
  verifyWebhook,
} from "./index";

describe("csv", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("census parsing", () => {
  it("normalizes headers and dates", () => {
    expect(normalizeHeader("Employee ID")).toBe("employee_id");
    expect(normalizeHeader("Date of Birth")).toBe("dob");
    expect(normalizeHeader("Zip Code")).toBe("zip");
    expect(normalizeDate("4/5/1990")).toBe("1990-04-05");
    expect(normalizeDate("1990-02-30")).toBeUndefined();
  });

  it("parses the template into employees, dependents and enrollments", () => {
    const r = parseCensusCsv(censusTemplateCsv(), { asOf: "2026-10-28" });
    expect(r.errors).toEqual([]);
    expect(r.employees).toHaveLength(1);
    expect(r.employees[0]).toMatchObject({ sourceId: "1001", ssnLast4: "4821", status: "active" });
    expect(r.dependents).toEqual([expect.objectContaining({ sourceId: "1001-D1", relationship: "spouse" })]);
    expect(r.enrollments).toHaveLength(4);
    expect(r.referencedPlanCodes.sort()).toEqual(["DEN-PPO", "MED-PPO"]);
  });

  it("reports row-level errors", () => {
    const csv = ["employee_id,relationship,first_name,last_name,dob,ssn_last4,address1,city,state,zip,hire_date,medical_plan,medical_tier", "7,employee,Pat,Doe,1990-13-01,12,1 Main,LB,CA,90802,2020-01-01,MED,platinum", "8,cousin,X,Y,1990-01-01,,,,,,,,"].join("\n");
    const r = parseCensusCsv(csv);
    const messages = r.errors.map((e) => `${e.row}:${e.column}`);
    expect(messages).toContain("2:dob");
    expect(messages).toContain("2:ssn_last4");
    expect(messages).toContain("2:medical_tier");
    expect(messages).toContain("3:relationship");
  });

  it("marks past termination dates as terminated", () => {
    const csv = ["employee_id,first_name,last_name,dob,ssn_last4,address1,city,state,zip,hire_date,termination_date", "9,Lee,Kim,1980-01-01,9999,1 Main,LB,CA,90802,2020-01-01,10/15/2026"].join("\n");
    const r = parseCensusCsv(csv, { asOf: "2026-10-28" });
    expect(r.employees[0]).toMatchObject({ status: "terminated", terminationDate: "2026-10-15" });
  });

  it("requires the key columns", () => {
    expect(parseCensusCsv("name,dob\nA,1990-01-01").errors[0]?.message).toMatch(/employee_id/);
  });

  it("parses plan rate sheets into cents", () => {
    const { plans, errors } = parsePlansCsv(plansTemplateCsv());
    expect(errors).toEqual([]);
    expect(plans[0]).toMatchObject({ sourceId: "MED-PPO", type: "medical", insured: true, ratesByTier: { employee: 65_000, family: 185_000 } });
  });

  it("rejects bad plan types and rates", () => {
    const { errors } = parsePlansCsv("plan_code,carrier,plan_name,type,rate_employee\nX,C,P,pet,12\nY,C,P,dental,abc");
    expect(errors.map((e) => e.column)).toEqual(["type", "rate_employee"]);
  });
});

describe("event detection", () => {
  const base = sandboxSnapshot();
  const prev = { employees: base.employees, dependents: base.dependents, enrollments: base.enrollments };

  it("detects a new termination", () => {
    const next = { ...prev, employees: prev.employees.map((e) => (e.sourceId === "E100" ? { ...e, terminationDate: "2026-10-20", terminationReason: "voluntary" } : e)) };
    expect(detectEvents(prev, next, "2026-10-21")).toEqual([expect.objectContaining({ kind: "termination", employeeSourceId: "E100", eventDate: "2026-10-20" })]);
  });

  it("detects a reversed termination as a rehire", () => {
    const terminated = { ...prev, employees: prev.employees.map((e) => (e.sourceId === "E101" ? { ...e, terminationDate: "2026-10-20" } : e)) };
    expect(detectEvents(terminated, prev, "2026-10-22")[0]?.kind).toBe("rehire");
  });

  it("detects a reduction in hours that ends coverage", () => {
    const next = {
      ...prev,
      employees: prev.employees.map((e) => (e.sourceId === "E101" ? { ...e, weeklyHours: 20 } : e)),
      enrollments: prev.enrollments.filter((en) => en.personSourceId !== "E101"),
    };
    expect(detectEvents(prev, next, "2026-10-28")).toEqual([expect.objectContaining({ kind: "reduction_in_hours", employeeSourceId: "E101" })]);
  });

  it("flags a dependent removed from coverage for review", () => {
    const next = { ...prev, enrollments: prev.enrollments.filter((en) => en.personSourceId !== "E102-D1") };
    expect(detectEvents(prev, next, "2026-10-28")).toEqual([expect.objectContaining({ kind: "dependent_removed", dependentSourceId: "E102-D1" })]);
  });

  it("finds nothing when nothing changed", () => {
    expect(detectEvents(prev, prev)).toEqual([]);
  });
});

describe("rates and merging", () => {
  it("derives monthly premiums from pay-period deductions", () => {
    expect(deriveMonthlyPremium(10_000, 20_000, "biweekly")).toBe(65_000);
    expect(deriveMonthlyPremium(15_000, 15_000, "semimonthly")).toBe(60_000);
  });

  it("matches people by SSN hash first, then name and DOB", () => {
    expect(matchKey({ ssnHash: "abc", firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" })).toBe("ssn:abc");
    expect(matchKey({ firstName: " Ann ", lastName: "Lee", dateOfBirth: "1990-01-01" })).toBe("nd:ann|lee|1990-01-01");
  });

  it("lets payroll win employment fields and lists conflicts", () => {
    const [emp] = sandboxSnapshot().employees;
    const { merged, conflicts } = mergeEmployees([{ ...emp!, terminationDate: "2026-10-01" }], [{ ...emp!, sourceId: "BA-1", terminationDate: "2026-09-30" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.terminationDate).toBe("2026-10-01");
    expect(conflicts).toEqual([expect.objectContaining({ field: "terminationDate" })]);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"event":"employment.updated"}';

  it("accepts a fresh, valid signature", () => {
    const ts = 1_800_000_000;
    expect(verifyWebhook({ secret, body, timestamp: String(ts), signature: signWebhook(secret, ts, body), nowSeconds: ts + 10 })).toEqual({ ok: true });
  });

  it("rejects tampering and replays", () => {
    const ts = 1_800_000_000;
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhook({ secret, body: body + " ", timestamp: String(ts), signature: sig, nowSeconds: ts }).ok).toBe(false);
    expect(verifyWebhook({ secret, body, timestamp: String(ts), signature: sig, nowSeconds: ts + 301 }).ok).toBe(false);
    expect(verifyWebhook({ secret, body, timestamp: undefined, signature: sig }).ok).toBe(false);
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Isolated embedded database and a fixed clock, set before anything touches the DB.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "cod-test-"));
process.env.COD_TODAY = "2026-10-28";
process.env.LOG_MESSAGES = "false";

const core = await import("./index");
const { getDb, tables } = await import("@cod/db");
const { eq } = await import("drizzle-orm");

const user = { type: "user" as const, id: "test-user" };
let companyId = "";
let slug = "";

async function qbsFor(eventId: string) {
  const db = await getDb();
  return db.select().from(tables.qualifiedBeneficiaries).where(eq(tables.qualifiedBeneficiaries.eventId, eventId));
}

describe("full COBRA lifecycle", () => {
  beforeAll(async () => {
    await getDb();
  }, 60_000);

  it("declines groups under 20 employees at sign-up", async () => {
    await expect(
      core.signUpEmployer(
        { contactName: "Pat Small", contactRole: "Owner", contactTitle: "CEO", email: "pat@small.example", password: "a-long-password-123", companyName: "Small Shop", state: "CA", priorYearEmployeeCount: 12, acceptTerms: true, confirmAuthority: true },
        {},
      ),
    ).rejects.toThrow(/carrier handles Cal-COBRA/);
  });

  it("signs up, imports from the sandbox, and goes live", async () => {
    const { company } = await core.signUpEmployer(
      { contactName: "Rob Admin", contactRole: "HR", contactTitle: "HR Director", email: "hr@harbor.example", password: "a-long-password-123", companyName: "Harbor Demo Manufacturing, Inc.", state: "CA", priorYearEmployeeCount: 42, acceptTerms: true, confirmAuthority: true },
        { ip: "127.0.0.1" },
      );
    companyId = company.id;
    slug = company.slug;
    expect(slug).toBe("harbor-demo-manufacturing");

    await core.connectSandbox(companyId, user);
    await core.updateCompanyProfile(
      companyId,
      core.profileSchema.parse({
        legalName: "Harbor Demo Manufacturing, Inc.",
        ein: "12-3456789",
        addressLine1: "100 Ocean Blvd",
        city: "Long Beach",
        state: "CA",
        postalCode: "90802",
        phone: "562-555-0100",
        priorYearEmployeeCount: 42,
        benefitEligibleCount: 40,
        benefitEnrolledCount: 30,
        planName: "Harbor Demo Health Plan",
        planYearStart: "2026-01-01",
        planAdministratorName: "Harbor Demo Manufacturing, Inc.",
        hrContactName: "Rob Admin",
        hrContactEmail: "hr@harbor.example",
      }),
      user,
    );
    for (const m of ["employees", "dependents", "plans", "elections"] as const) await core.confirmModule(companyId, m, user);
    await expect(core.goLive(companyId, user)).rejects.toThrow(/billing/);
    await core.addBillingMethodDev(companyId, user);
    const { invited } = await core.goLive(companyId, user);
    expect(invited).toBe(3);
  }, 60_000);

  it("records affirmative e-delivery consent only after the test PDF is opened", async () => {
    const db = await getDb();
    const [avery] = await db.select().from(tables.employees).where(eq(tables.employees.sourceId, "E100"));
    const token = core.consentToken(avery!.id);
    expect(core.parseConsentToken(`${avery!.id}.forged`)).toBeNull();
    await expect(core.recordConsent(token, { email: "avery.chen@example.com", testPdfOpened: false })).rejects.toThrow(/test document/);
    await core.recordConsent(token, { email: "avery.chen@example.com", testPdfOpened: true });
  });

  let eventId = "";

  it("detects a termination from sync, holds for confirmation, then sends one packet per address", async () => {
    const sync = await core.simulateSandboxChange(companyId, { kind: "terminate", employeeSourceId: "E100", terminationDate: "2026-10-23" }, user);
    expect(sync.eventsCreated).toHaveLength(1);
    eventId = sync.eventsCreated[0]!;
    const ev = await core.getEvent(companyId, eventId);
    expect(ev).toMatchObject({ status: "pending_confirmation", lastCoveredDay: "2026-10-31", lossOfCoverageDate: "2026-11-01", electionNoticeDue: "2026-11-11", sendBy: "2026-11-11" });
    expect(ev.coverageSnapshot!.plans.map((p) => p.code).sort()).toEqual(["DEN-PPO", "MED-PPO"]); // life insurance excluded

    await core.confirmEvent(companyId, eventId, user);
    const qbs = await qbsFor(eventId);
    expect(qbs).toHaveLength(3);
    expect(qbs.every((q) => q.status === "notice_sent" && q.electionDeadline === "2026-12-31" && q.maxCoverageEnd === "2028-04-30")).toBe(true);

    const notices = await core.listNoticesForEvent(eventId);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.channel).toBe("email");
    const doc = await core.getNoticeDocument(companyId, notices[0]!.id);
    expect(Buffer.from(doc!.bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const db = await getDb();
    const charges = await db.select().from(tables.employerCharges).where(eq(tables.employerCharges.companyId, companyId));
    expect(charges.map((c) => [c.type, c.amount])).toEqual([["packet", 1200]]);
  }, 60_000);

  let qbId = "";

  it("verifies identity with term date, last 4 and DOB plus a one-time code, and rate-limits failures", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(core.startVerification({ slug, eventDate: "2026-10-23", last4: "9999", dob: "1984-02-14", ip: "10.0.0.9" })).rejects.toThrow(/don't match/);
    }
    await expect(core.startVerification({ slug, eventDate: "2026-10-23", last4: "1111", dob: "1984-02-14", ip: "10.0.0.9" })).rejects.toThrow(/Too many attempts/);

    const started = await core.startVerification({ slug, eventDate: "2026-10-23", last4: "1111", dob: "1984-02-14", ip: "10.0.0.1" });
    await expect(core.verifyCode(started.qbId, "000000" === started.devCode ? "111111" : "000000")).rejects.toThrow();
    const session = await core.verifyCode(started.qbId, started.devCode!);
    qbId = session.qbId;

    // The spouse verifies with the employee's last 4 and her own DOB.
    const spouse = await core.startVerification({ slug, eventDate: "2026-10-23", last4: "1111", dob: "1985-08-09", ip: "10.0.0.2" });
    expect(spouse.qbId).not.toBe(qbId);
  });

  it("elects per person and plan, bills the right tiers, and activates on payment", async () => {
    const view = await core.getEnrolleeView(qbId);
    expect(view.manageable).toHaveLength(3);
    const med = view.plans.find((p) => p.name === "Gold PPO 500")!;
    const den = view.plans.find((p) => p.name === "Dental PPO")!;
    const byName = Object.fromEntries(view.household.map((q) => [q.firstName, q.id]));

    await expect(
      core.submitElections({ actorQbId: qbId, decisions: { [byName.Avery!]: { [med.planId]: "elect" } }, signedName: "Avery Chen", stateNoticesReviewed: true }),
    ).rejects.toThrow(/Dental PPO/);
    await expect(
      core.submitElections({ actorQbId: qbId, decisions: { [byName.Avery!]: { [med.planId]: "waive", [den.planId]: "waive" } }, signedName: "Avery Chen", stateNoticesReviewed: false }),
    ).rejects.toThrow(/California/);

    await core.acknowledgeNotice(qbId, { ip: "10.0.0.1" });
    const { confirmationCode, invoice } = await core.submitElections({
      actorQbId: qbId,
      decisions: {
        [byName.Avery!]: { [med.planId]: "elect", [den.planId]: "elect" },
        [byName.Riley!]: { [med.planId]: "elect", [den.planId]: "waive" },
        [byName.Jamie!]: { [med.planId]: "elect", [den.planId]: "elect" },
      },
      signedName: "Avery Chen",
      stateNoticesReviewed: true,
    });
    expect(confirmationCode).toMatch(/^[A-Z2-9]{8}$/);
    // Medical: family ($1,850). Dental: Avery + Jamie = employee + child(ren) ($90). First month only (Nov 2026).
    expect(invoice).toMatchObject({ amountDue: 194_000, dueDate: "2026-10-28", finalPaymentDate: "2026-12-12", periodStart: "2026-11-01", periodEnd: "2026-11-30" });

    const account = await core.createEnrolleeAccount(qbId, "avery.chen@example.com", "another-long-pass");
    const method = await core.addPaymentMethod(account.id, "ach", true, { type: "enrollee", id: qbId });
    const paid = await core.payInvoice(invoice!.id, method.id, { type: "enrollee", id: qbId });
    expect(paid.status).toBe("paid");
    expect((await qbsFor(eventId)).map((q) => q.status)).toEqual(["active", "active", "active"]);
    expect(await core.loginEnrollee(slug, "avery.chen@example.com", "another-long-pass")).toMatchObject({ eventId });
  }, 60_000);

  it("runs monthly jobs: autopay invoice and per-enrollee employer fee", async () => {
    process.env.COD_TODAY = "2026-12-01";
    const inv = await core.runJob("generate-invoices");
    expect(inv).toEqual({ created: 1, charged: 1 });
    expect(await core.runJob("generate-invoices")).toEqual({ created: 0, charged: 0 }); // idempotent

    const billing = await core.runJob("employer-billing");
    expect(billing).toEqual({ period: "2026-11", companiesCharged: 1 });
    const db = await getDb();
    const fees = (await db.select().from(tables.employerCharges).where(eq(tables.employerCharges.companyId, companyId))).filter((c) => c.type === "enrollee_month");
    expect(fees.map((f) => [f.quantity, f.amount])).toEqual([[3, 3600]]);

    const dash = await core.employerDashboard(companyId, "this_month");
    expect(dash.tiles.activeEnrollees).toBe(3);
    expect(dash.tiles.activeHouseholds).toBe(1);
  }, 60_000);

  it("mails the packet when there is no consent, bills the manual fee, and expires rights after day 60", async () => {
    process.env.COD_TODAY = "2026-12-02";
    const { eventsCreated } = await core.simulateSandboxChange(companyId, { kind: "terminate", employeeSourceId: "E101", terminationDate: "2026-11-30" }, user);
    await core.confirmEvent(companyId, eventsCreated[0]!, user);
    const notices = await core.listNoticesForEvent(eventsCreated[0]!);
    expect(notices[0]!.channel).toBe("email_and_mail");
    expect(notices[0]!.mailTrackingId).toBeTruthy();

    process.env.COD_TODAY = "2027-02-01";
    const r = await core.runJob("close-election-windows");
    expect(r.expired).toBe(1);
  }, 60_000);

  it("cancels a held event when the termination is reversed before sending", async () => {
    process.env.COD_TODAY = "2027-02-02";
    const { eventsCreated } = await core.simulateSandboxChange(companyId, { kind: "terminate", employeeSourceId: "E102", terminationDate: "2027-02-01" }, user);
    expect((await core.getEvent(companyId, eventsCreated[0]!)).status).toBe("pending_confirmation");
    await core.simulateSandboxChange(companyId, { kind: "rehire", employeeSourceId: "E102" }, user);
    expect((await core.getEvent(companyId, eventsCreated[0]!)).status).toBe("cancelled");
  }, 60_000);

  it("terminates coverage for nonpayment after the grace period", async () => {
    process.env.COD_TODAY = "2027-02-03";
    // Remove autopay so February's invoice goes unpaid.
    const db = await getDb();
    await db.update(tables.paymentMethods).set({ autopay: false });
    await core.runJob("generate-invoices");
    process.env.COD_TODAY = "2027-02-20";
    await core.runJob("grace-period-check");
    expect((await qbsFor(eventId)).every((q) => q.status === "grace")).toBe(true);
    process.env.COD_TODAY = "2027-03-04";
    const r = await core.runJob("grace-period-check");
    expect(r.terminated).toBe(3);
    expect((await qbsFor(eventId)).every((q) => q.status === "terminated" && q.terminationReason === "nonpayment")).toBe(true);
  }, 60_000);
});

/**
 * Development seed: synthetic data only (GH-7). Creates an ops user, launch
 * pricing, and a live demo employer connected to the sandbox, with one
 * termination already sent so the enrollee portal can be tried right away.
 */
import { eq } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { LAUNCH_PRICE_TIERS } from "@cod/billing";
import {
  addBillingMethodDev,
  confirmEvent,
  confirmModule,
  connectSandbox,
  consentToken,
  enrolleeUrl,
  getCompanyBySlug,
  goLive,
  hashPassword,
  profileSchema,
  recordConsent,
  signUpEmployer,
  simulateSandboxChange,
  today,
  updateCompanyProfile,
} from "../index";
import { addDays } from "@cod/rules";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
  console.error("Refusing to seed in production.");
  process.exit(1);
}
process.env.LOG_MESSAGES = "false";

const OPS_EMAIL = process.env.SEED_OPS_EMAIL ?? "ops@cobraondemand.local";
const OPS_PASSWORD = process.env.SEED_OPS_PASSWORD ?? "ops-dev-password-2026";
const EMPLOYER_EMAIL = process.env.SEED_EMPLOYER_EMAIL ?? "hr@harbor-demo.example";
const EMPLOYER_PASSWORD = process.env.SEED_EMPLOYER_PASSWORD ?? "employer-dev-password";

const db = await getDb();

const [ops] = await db.select().from(tables.users).where(eq(tables.users.email, OPS_EMAIL));
if (!ops) {
  await db.insert(tables.users).values({ email: OPS_EMAIL, passwordHash: await hashPassword(OPS_PASSWORD), name: "COBRA on Demand Ops", kind: "ops" });
}

const tiers = await db.select().from(tables.priceTiers);
if (tiers.length === 0) {
  await db.insert(tables.priceTiers).values(LAUNCH_PRICE_TIERS.map((t) => ({ plan: t.plan, min: t.min, max: t.max, unitPrice: t.unitPrice })));
}

let company = await getCompanyBySlug("harbor-demo");
if (!company) {
  const { company: c, user } = await signUpEmployer(
    {
      contactName: "Dana Demo",
      contactRole: "HR",
      contactTitle: "HR Manager",
      email: EMPLOYER_EMAIL,
      password: EMPLOYER_PASSWORD,
      companyName: "Harbor Demo",
      state: "CA",
      priorYearEmployeeCount: 42,
      acceptTerms: true,
      confirmAuthority: true,
    },
    { ip: "127.0.0.1", userAgent: "seed" },
  );
  const actor = { type: "user" as const, id: user.id };
  await connectSandbox(c.id, actor);
  await updateCompanyProfile(
    c.id,
    profileSchema.parse({
      legalName: "Harbor Demo Manufacturing, Inc.",
      ein: "00-0000000",
      addressLine1: "100 Ocean Blvd",
      city: "Long Beach",
      state: "CA",
      postalCode: "90802",
      phone: "562-555-0100",
      priorYearEmployeeCount: 42,
      benefitEligibleCount: 40,
      benefitEnrolledCount: 30,
      planName: "Harbor Demo Health and Welfare Plan",
      planYearStart: "2026-01-01",
      planAdministratorName: "Harbor Demo Manufacturing, Inc.",
      hrContactName: "Dana Demo",
      hrContactEmail: EMPLOYER_EMAIL,
      hrContactPhone: "562-555-0100",
    }),
    actor,
  );
  for (const m of ["employees", "dependents", "plans", "elections"] as const) await confirmModule(c.id, m, actor);
  await addBillingMethodDev(c.id, actor);
  await goLive(c.id, actor);

  const [avery] = await db.select().from(tables.employees).where(eq(tables.employees.sourceId, "E100"));
  await recordConsent(consentToken(avery!.id), { email: "avery.chen@example.com", testPdfOpened: true, ip: "127.0.0.1" });

  const termDate = addDays(today(), -5);
  const { eventsCreated } = await simulateSandboxChange(c.id, { kind: "terminate", employeeSourceId: "E100", terminationDate: termDate, reason: "voluntary" }, actor);
  if (eventsCreated[0]) await confirmEvent(c.id, eventsCreated[0], actor);
  company = c;
  console.log(`Demo termination: Avery Chen, ${termDate}. Verify with last 4 "1111" and DOB 1984-02-14 (spouse Riley: 1985-08-09).`);
}

// Passwords supplied through the environment (Secret Manager) are never echoed to logs.
const shown = (pw: string, envName: string) => (process.env[envName] ? `(password in secret ${envName})` : pw);
console.log(`
Seeded.
  Ops console     ${OPS_EMAIL} / ${shown(OPS_PASSWORD, "SEED_OPS_PASSWORD")}
  Employer        ${EMPLOYER_EMAIL} / ${shown(EMPLOYER_PASSWORD, "SEED_EMPLOYER_PASSWORD")}
  Enrollee portal ${enrolleeUrl(company.slug)}
`);
process.exit(0);

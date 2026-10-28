import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Data model from the requirements outline. Every tenant table carries
 * company_id; row-level security policies live in drizzle/rls.sql. SSN, DOB
 * and EIN are stored encrypted (see crypto.ts) and never sent to the client.
 * Money is integer cents; legal dates are `date` columns as ISO strings.
 */

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const day = (name: string) => date(name, { mode: "string" });
const companyRef = () => text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" });

export type CompanySettings = {
  /** "immediate" sends packets right away; "hold" waits for a one-tap confirm (TRG-6). */
  sendMode: "immediate" | "hold";
  autoProceedDays: number;
  /** Default company-paid COBRA applied to new events (QE-2). */
  defaultSubsidy?: { months: number; percent: number } | null;
  remindersEnabled: boolean;
};

export type Address = { line1: string; line2?: string; city: string; state: string; postalCode: string };

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["employer", "ops", "broker"] }).notNull(),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const companies = pgTable("companies", {
  id: id(),
  slug: text("slug").notNull().unique(),
  legalName: text("legal_name").notNull(),
  dba: text("dba"),
  einEnc: text("ein_enc"),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state").notNull().default("CA"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  priorYearEmployeeCount: integer("prior_year_employee_count"),
  benefitEligibleCount: integer("benefit_eligible_count"),
  benefitEnrolledCount: integer("benefit_enrolled_count"),
  currentCobraEnrollees: integer("current_cobra_enrollees"),
  regime: text("regime", { enum: ["federal", "state", "none"] }),
  stateExtensionApplies: boolean("state_extension_applies").notNull().default(false),
  status: text("status", { enum: ["onboarding", "live", "suspended"] }).notNull().default("onboarding"),
  planName: text("plan_name"),
  planYearStart: day("plan_year_start"),
  planAdministratorName: text("plan_administrator_name"),
  erisaPlanNumber: text("erisa_plan_number"),
  contactName: text("contact_name").notNull(),
  contactRole: text("contact_role"),
  contactTitle: text("contact_title"),
  contactEmail: text("contact_email").notNull(),
  hrContactName: text("hr_contact_name"),
  hrContactPhone: text("hr_contact_phone"),
  hrContactEmail: text("hr_contact_email"),
  settings: jsonb("settings").$type<CompanySettings>().notNull(),
  liveAt: timestamp("live_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const companyUsers = pgTable(
  "company_users",
  {
    id: id(),
    companyId: companyRef(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "hr", "billing", "read_only"] }).notNull(),
    confirmsTerminations: boolean("confirms_terminations").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("company_users_company_user").on(t.companyId, t.userId)],
);

export const agreements = pgTable("agreements", {
  id: id(),
  companyId: companyRef(),
  type: text("type", { enum: ["terms_of_service", "service_agreement", "baa"] }).notNull(),
  version: text("version").notNull(),
  signerName: text("signer_name").notNull(),
  signerTitle: text("signer_title").notNull(),
  authorityConfirmed: boolean("authority_confirmed").notNull(),
  signedByUserId: text("signed_by_user_id").references(() => users.id),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  documentSha256: text("document_sha256").notNull(),
});

export const SETUP_MODULES = [
  "company_profile",
  "employees",
  "dependents",
  "plans",
  "elections",
  "current_cobra",
  "admin_users",
  "billing",
  "automation",
  "review",
] as const;
export type SetupModule = (typeof SETUP_MODULES)[number];

export const setupModules = pgTable(
  "setup_modules",
  {
    id: id(),
    companyId: companyRef(),
    module: text("module", { enum: SETUP_MODULES }).notNull(),
    sourceType: text("source_type"),
    integrationId: text("integration_id"),
    status: text("status", { enum: ["not_started", "in_progress", "needs_review", "complete"] }).notNull().default("not_started"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    sourceHistory: jsonb("source_history").$type<{ source: string; switchedAt: string }[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("setup_modules_company_module").on(t.companyId, t.module)],
);

export const integrations = pgTable("integrations", {
  id: id(),
  companyId: companyRef(),
  provider: text("provider").notNull(),
  connectionId: text("connection_id").notNull(),
  status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("connected"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  /** Last canonical snapshot, used to diff the next sync (INT-13). */
  lastSnapshot: jsonb("last_snapshot"),
  createdAt: createdAt(),
});

export const syncRuns = pgTable("sync_runs", {
  id: id(),
  integrationId: text("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  diffSummary: jsonb("diff_summary"),
  errors: jsonb("errors"),
});

export const plans = pgTable(
  "plans",
  {
    id: id(),
    companyId: companyRef(),
    code: text("code").notNull(),
    carrierName: text("carrier_name").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    groupNumber: text("group_number"),
    insured: boolean("insured").notNull().default(true),
    cobraEligible: boolean("cobra_eligible").notNull(),
    coverageEndRule: text("coverage_end_rule", { enum: ["end_of_month", "termination_date"] }).notNull().default("end_of_month"),
    planYearStart: day("plan_year_start"),
    source: text("source").notNull().default("manual"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plans_company_code").on(t.companyId, t.code)],
);

export const planRates = pgTable(
  "plan_rates",
  {
    id: id(),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    tier: text("tier", { enum: ["employee", "employee_spouse", "employee_children", "family"] }).notNull(),
    /** Total monthly cost (employer + employee share), cents (PLN-14). */
    monthlyCost: integer("monthly_cost").notNull(),
    effectiveFrom: day("effective_from").notNull(),
  },
  (t) => [uniqueIndex("plan_rates_plan_tier_effective").on(t.planId, t.tier, t.effectiveFrom)],
);

export const employees = pgTable(
  "employees",
  {
    id: id(),
    companyId: companyRef(),
    sourceId: text("source_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dobEnc: text("dob_enc").notNull(),
    ssnEnc: text("ssn_enc"),
    /** HMAC of the last 4 of the SSN, keyed per company, for identity checks. */
    ssnLast4Hash: text("ssn_last4_hash").notNull(),
    address: jsonb("address").$type<Address>().notNull(),
    email: text("email"),
    phone: text("phone"),
    status: text("status", { enum: ["active", "terminated", "leave"] }).notNull(),
    hireDate: day("hire_date"),
    terminationDate: day("termination_date"),
    terminationReason: text("termination_reason"),
    weeklyHours: integer("weekly_hours"),
    source: text("source").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("employees_company_source").on(t.companyId, t.sourceId)],
);

export const dependents = pgTable(
  "dependents",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dobEnc: text("dob_enc").notNull(),
    relationship: text("relationship", { enum: ["spouse", "child"] }).notNull(),
    address: jsonb("address").$type<Address>(),
    email: text("email"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dependents_company_source").on(t.companyId, t.sourceId)],
);

export const coverages = pgTable(
  "coverages",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    dependentId: text("dependent_id").references(() => dependents.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    tier: text("tier", { enum: ["employee", "employee_spouse", "employee_children", "family"] }).notNull(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date"),
  },
  (t) => [index("coverages_employee").on(t.employeeId)],
);

export type CoverageSnapshot = {
  takenAt: string;
  plans: { planId: string; code: string; name: string; carrier: string; type: string; insured: boolean; tier: string; rates: { tier: string; monthlyCost: number }[] }[];
  people: { personKey: string; dependentId: string | null; relationship: "employee" | "spouse" | "child"; firstName: string; lastName: string; planIds: string[]; address: Address; email: string | null }[];
};

export const qualifyingEvents = pgTable(
  "qualifying_events",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    dependentId: text("dependent_id").references(() => dependents.id),
    type: text("type").notNull(),
    eventDate: day("event_date").notNull(),
    lastCoveredDay: day("last_covered_day").notNull(),
    lossOfCoverageDate: day("loss_of_coverage_date").notNull(),
    receivedOn: day("received_on").notNull(),
    reportDue: day("report_due").notNull(),
    electionNoticeDue: day("election_notice_due").notNull(),
    sendBy: day("send_by").notNull(),
    autoProceedOn: day("auto_proceed_on"),
    status: text("status", { enum: ["pending_confirmation", "scheduled", "ready", "sent", "cancelled", "no_coverage", "needs_review"] }).notNull(),
    source: text("source", { enum: ["sync", "census", "manual", "beneficiary"] }).notNull(),
    reason: text("reason"),
    grossMisconduct: boolean("gross_misconduct").notNull().default(false),
    subsidyMonths: integer("subsidy_months"),
    subsidyPercent: integer("subsidy_percent"),
    /** INT-15: coverage frozen as of the day before loss of coverage. Notices come from this, never live data. */
    coverageSnapshot: jsonb("coverage_snapshot").$type<CoverageSnapshot>(),
    reportedBy: text("reported_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("qe_company_status").on(t.companyId, t.status)],
);

export const enrolleeAccounts = pgTable(
  "enrollee_accounts",
  {
    id: id(),
    companyId: companyRef(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("enrollee_accounts_company_email").on(t.companyId, t.email)],
);

export const qualifiedBeneficiaries = pgTable(
  "qualified_beneficiaries",
  {
    id: id(),
    companyId: companyRef(),
    eventId: text("event_id").notNull().references(() => qualifyingEvents.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    dependentId: text("dependent_id").references(() => dependents.id),
    relationship: text("relationship", { enum: ["employee", "spouse", "child"] }).notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    address: jsonb("address").$type<Address>().notNull(),
    status: text("status").notNull().default("pending_notice"),
    cobraStart: day("cobra_start").notNull(),
    maxCoverageEnd: day("max_coverage_end").notNull(),
    electionDeadline: day("election_deadline"),
    noticeSentOn: day("notice_sent_on"),
    noticeAcknowledgedAt: timestamp("notice_acknowledged_at", { withTimezone: true }),
    noticeAckMeta: jsonb("notice_ack_meta"),
    electedOn: day("elected_on"),
    waivedOn: day("waived_on"),
    terminatedOn: day("terminated_on"),
    terminationReason: text("termination_reason"),
    accountId: text("account_id").references(() => enrolleeAccounts.id),
    createdAt: createdAt(),
  },
  (t) => [index("qb_event").on(t.eventId), index("qb_company_status").on(t.companyId, t.status)],
);

export const elections = pgTable("elections", {
  id: id(),
  companyId: companyRef(),
  eventId: text("event_id").notNull().references(() => qualifyingEvents.id, { onDelete: "cascade" }),
  qbId: text("qb_id").notNull().references(() => qualifiedBeneficiaries.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  decision: text("decision", { enum: ["elect", "waive"] }).notNull(),
  signedName: text("signed_name").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  confirmationCode: text("confirmation_code").notNull(),
});

export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  companyId: companyRef(),
  accountId: text("account_id").notNull().references(() => enrolleeAccounts.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["ach", "card"] }).notNull(),
  /** Processor token (Stripe PaymentMethod id). Card and bank numbers are never stored. */
  processorRef: text("processor_ref").notNull(),
  last4: text("last4"),
  autopay: boolean("autopay").notNull().default(true),
  status: text("status", { enum: ["active", "removed"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const premiumInvoices = pgTable(
  "premium_invoices",
  {
    id: id(),
    companyId: companyRef(),
    eventId: text("event_id").notNull().references(() => qualifyingEvents.id, { onDelete: "cascade" }),
    accountId: text("account_id").references(() => enrolleeAccounts.id),
    kind: text("kind", { enum: ["initial", "monthly"] }).notNull(),
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    dueDate: day("due_date").notNull(),
    finalPaymentDate: day("final_payment_date").notNull(),
    amountDue: integer("amount_due").notNull(),
    subsidyAmount: integer("subsidy_amount").notNull().default(0),
    status: text("status", { enum: ["open", "paid", "shortfall_cure", "lapsed", "void"] }).notNull().default("open"),
    lines: jsonb("lines").$type<{ planName: string; tier: string; amount: number }[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_event").on(t.eventId)],
);

export const payments = pgTable("payments", {
  id: id(),
  companyId: companyRef(),
  invoiceId: text("invoice_id").notNull().references(() => premiumInvoices.id, { onDelete: "cascade" }),
  methodId: text("method_id").references(() => paymentMethods.id),
  amount: integer("amount").notNull(),
  paidOn: day("paid_on").notNull(),
  processorRef: text("processor_ref"),
  status: text("status", { enum: ["succeeded", "failed", "refunded"] }).notNull(),
  createdAt: createdAt(),
});

export const documents = pgTable("documents", {
  id: id(),
  companyId: companyRef(),
  kind: text("kind").notNull(),
  storagePath: text("storage_path").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mime: text("mime").notNull(),
  retentionUntil: day("retention_until").notNull(),
  createdAt: createdAt(),
});

export const notices = pgTable(
  "notices",
  {
    id: id(),
    companyId: companyRef(),
    eventId: text("event_id").references(() => qualifyingEvents.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").references(() => employees.id),
    addresseeQbIds: jsonb("addressee_qb_ids").$type<string[]>().notNull().default([]),
    addresseeName: text("addressee_name").notNull(),
    addresseeEmail: text("addressee_email"),
    type: text("type").notNull(),
    templateVersions: jsonb("template_versions").$type<Record<string, string>>().notNull(),
    packet: jsonb("packet"),
    documentId: text("document_id").references(() => documents.id),
    deadline: day("deadline"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    channel: text("channel", { enum: ["email", "mail", "email_and_mail"] }),
    mailTrackingId: text("mail_tracking_id"),
    status: text("status", { enum: ["generated", "sent", "delivered", "bounced", "returned"] }).notNull().default("generated"),
    createdAt: createdAt(),
  },
  (t) => [index("notices_event").on(t.eventId)],
);

export const eDeliveryConsents = pgTable("e_delivery_consents", {
  id: id(),
  companyId: companyRef(),
  employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  disclosureVersion: text("disclosure_version").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  testPdfOpenedAt: timestamp("test_pdf_opened_at", { withTimezone: true }),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const priceTiers = pgTable("price_tiers", {
  id: id(),
  plan: text("plan", { enum: ["standard", "volume"] }).notNull(),
  min: integer("min").notNull(),
  max: integer("max"),
  unitPrice: integer("unit_price").notNull(),
  active: boolean("active").notNull().default(true),
});

export const billingAccounts = pgTable("billing_accounts", {
  id: id(),
  companyId: companyRef().unique(),
  payerType: text("payer_type", { enum: ["employer", "broker"] }).notNull().default("employer"),
  paymentMethodStatus: text("payment_method_status", { enum: ["none", "pending", "on_file"] }).notNull().default("none"),
  processorCustomerId: text("processor_customer_id"),
  paymentMethodSummary: text("payment_method_summary"),
  brokerEmail: text("broker_email"),
  linkExpiresAt: timestamp("link_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employerCharges = pgTable("employer_charges", {
  id: id(),
  companyId: companyRef(),
  type: text("type", { enum: ["packet", "enrollee_month", "manual_admin", "upgrade"] }).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  amount: integer("amount").notNull(),
  /** Billing month, YYYY-MM. */
  period: text("period").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  postingId: text("posting_id").notNull(),
  companyId: text("company_id").references(() => companies.id),
  account: text("account").notNull(),
  debit: integer("debit").notNull().default(0),
  credit: integer("credit").notNull().default(0),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  memo: text("memo"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    dueAt: day("due_at"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    assignedTo: text("assigned_to"),
    resolution: text("resolution"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("tasks_status").on(t.status)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["email", "sms", "mail"] }).notNull(),
    to: text("to").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    status: text("status", { enum: ["queued", "sent", "delivered", "bounced", "failed"] }).notNull().default("queued"),
    providerRef: text("provider_ref"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_related").on(t.relatedType, t.relatedId)],
);

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  qbId: text("qb_id").notNull().references(() => qualifiedBeneficiaries.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  sentTo: text("sent_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const verificationAttempts = pgTable(
  "verification_attempts",
  {
    id: id(),
    companyId: companyRef(),
    ip: text("ip").notNull(),
    success: boolean("success").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_attempts_company_ip_at").on(t.companyId, t.ip, t.at)],
);

/** Append-only (OPS-5, ERISA 6+ year retention). The app never updates or deletes rows here. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
    actorType: text("actor_type", { enum: ["user", "enrollee", "system", "ops"] }).notNull(),
    actorId: text("actor_id"),
    companyId: text("company_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
  },
  (t) => [index("audit_company_at").on(t.companyId, t.at)],
);

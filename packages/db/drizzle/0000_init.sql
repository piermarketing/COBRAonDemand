CREATE TABLE "agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"signer_name" text NOT NULL,
	"signer_title" text NOT NULL,
	"authority_confirmed" boolean NOT NULL,
	"signed_by_user_id" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"document_sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"company_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"payer_type" text DEFAULT 'employer' NOT NULL,
	"payment_method_status" text DEFAULT 'none' NOT NULL,
	"processor_customer_id" text,
	"payment_method_summary" text,
	"broker_email" text,
	"link_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"dba" text,
	"ein_enc" text,
	"address_line1" text,
	"city" text,
	"state" text DEFAULT 'CA' NOT NULL,
	"postal_code" text,
	"phone" text,
	"prior_year_employee_count" integer,
	"benefit_eligible_count" integer,
	"benefit_enrolled_count" integer,
	"current_cobra_enrollees" integer,
	"regime" text,
	"state_extension_applies" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"plan_name" text,
	"plan_year_start" date,
	"plan_administrator_name" text,
	"erisa_plan_number" text,
	"contact_name" text NOT NULL,
	"contact_role" text,
	"contact_title" text,
	"contact_email" text NOT NULL,
	"hr_contact_name" text,
	"hr_contact_phone" text,
	"hr_contact_email" text,
	"settings" jsonb NOT NULL,
	"live_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_users" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"confirms_terminations" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverages" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"dependent_id" text,
	"plan_id" text NOT NULL,
	"tier" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "dependents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"source_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob_enc" text NOT NULL,
	"relationship" text NOT NULL,
	"address" jsonb,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"retention_until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e_delivery_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"email" text NOT NULL,
	"disclosure_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"test_pdf_opened_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"event_id" text NOT NULL,
	"qb_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"decision" text NOT NULL,
	"signed_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"confirmation_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"source_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob_enc" text NOT NULL,
	"ssn_enc" text,
	"ssn_last4_hash" text NOT NULL,
	"address" jsonb NOT NULL,
	"email" text,
	"phone" text,
	"status" text NOT NULL,
	"hire_date" date,
	"termination_date" date,
	"termination_reason" text,
	"weekly_hours" integer,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employer_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"period" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"invoiced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollee_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text NOT NULL,
	"connection_id" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"posting_id" text NOT NULL,
	"company_id" text,
	"account" text NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"memo" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"related_type" text,
	"related_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"event_id" text,
	"employee_id" text,
	"addressee_qb_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"addressee_name" text NOT NULL,
	"addressee_email" text,
	"type" text NOT NULL,
	"template_versions" jsonb NOT NULL,
	"packet" jsonb,
	"document_id" text,
	"deadline" date,
	"sent_at" timestamp with time zone,
	"channel" text,
	"mail_tracking_id" text,
	"status" text DEFAULT 'generated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"qb_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"sent_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"processor_ref" text NOT NULL,
	"last4" text,
	"autopay" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"method_id" text,
	"amount" integer NOT NULL,
	"paid_on" date NOT NULL,
	"processor_ref" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"tier" text NOT NULL,
	"monthly_cost" integer NOT NULL,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"carrier_name" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"group_number" text,
	"insured" boolean DEFAULT true NOT NULL,
	"cobra_eligible" boolean NOT NULL,
	"coverage_end_rule" text DEFAULT 'end_of_month' NOT NULL,
	"plan_year_start" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premium_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"event_id" text NOT NULL,
	"account_id" text,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"final_payment_date" date NOT NULL,
	"amount_due" integer NOT NULL,
	"subsidy_amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"min" integer NOT NULL,
	"max" integer,
	"unit_price" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualified_beneficiaries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"event_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"dependent_id" text,
	"relationship" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"address" jsonb NOT NULL,
	"status" text DEFAULT 'pending_notice' NOT NULL,
	"cobra_start" date NOT NULL,
	"max_coverage_end" date NOT NULL,
	"election_deadline" date,
	"notice_sent_on" date,
	"notice_acknowledged_at" timestamp with time zone,
	"notice_ack_meta" jsonb,
	"elected_on" date,
	"waived_on" date,
	"terminated_on" date,
	"termination_reason" text,
	"account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualifying_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"dependent_id" text,
	"type" text NOT NULL,
	"event_date" date NOT NULL,
	"last_covered_day" date NOT NULL,
	"loss_of_coverage_date" date NOT NULL,
	"received_on" date NOT NULL,
	"report_due" date NOT NULL,
	"election_notice_due" date NOT NULL,
	"send_by" date NOT NULL,
	"auto_proceed_on" date,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"gross_misconduct" boolean DEFAULT false NOT NULL,
	"subsidy_months" integer,
	"subsidy_percent" integer,
	"coverage_snapshot" jsonb,
	"reported_by" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"module" text NOT NULL,
	"source_type" text,
	"integration_id" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"source_history" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"diff_summary" jsonb,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"due_at" date,
	"entity_type" text,
	"entity_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_dependent_id_dependents_id_fk" FOREIGN KEY ("dependent_id") REFERENCES "public"."dependents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependents" ADD CONSTRAINT "dependents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependents" ADD CONSTRAINT "dependents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_delivery_consents" ADD CONSTRAINT "e_delivery_consents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_delivery_consents" ADD CONSTRAINT "e_delivery_consents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_event_id_qualifying_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualifying_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_qb_id_qualified_beneficiaries_id_fk" FOREIGN KEY ("qb_id") REFERENCES "public"."qualified_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_charges" ADD CONSTRAINT "employer_charges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollee_accounts" ADD CONSTRAINT "enrollee_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_event_id_qualifying_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualifying_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_qb_id_qualified_beneficiaries_id_fk" FOREIGN KEY ("qb_id") REFERENCES "public"."qualified_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_account_id_enrollee_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."enrollee_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_premium_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."premium_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rates" ADD CONSTRAINT "plan_rates_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_invoices" ADD CONSTRAINT "premium_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_invoices" ADD CONSTRAINT "premium_invoices_event_id_qualifying_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualifying_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_invoices" ADD CONSTRAINT "premium_invoices_account_id_enrollee_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."enrollee_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualified_beneficiaries" ADD CONSTRAINT "qualified_beneficiaries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualified_beneficiaries" ADD CONSTRAINT "qualified_beneficiaries_event_id_qualifying_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."qualifying_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualified_beneficiaries" ADD CONSTRAINT "qualified_beneficiaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualified_beneficiaries" ADD CONSTRAINT "qualified_beneficiaries_dependent_id_dependents_id_fk" FOREIGN KEY ("dependent_id") REFERENCES "public"."dependents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualified_beneficiaries" ADD CONSTRAINT "qualified_beneficiaries_account_id_enrollee_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."enrollee_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_events" ADD CONSTRAINT "qualifying_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_events" ADD CONSTRAINT "qualifying_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_events" ADD CONSTRAINT "qualifying_events_dependent_id_dependents_id_fk" FOREIGN KEY ("dependent_id") REFERENCES "public"."dependents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_modules" ADD CONSTRAINT "setup_modules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_company_at" ON "audit_log" USING btree ("company_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_users_company_user" ON "company_users" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "coverages_employee" ON "coverages" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dependents_company_source" ON "dependents" USING btree ("company_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_source" ON "employees" USING btree ("company_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollee_accounts_company_email" ON "enrollee_accounts" USING btree ("company_id","email");--> statement-breakpoint
CREATE INDEX "messages_related" ON "messages" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX "notices_event" ON "notices" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_rates_plan_tier_effective" ON "plan_rates" USING btree ("plan_id","tier","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_company_code" ON "plans" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "invoices_event" ON "premium_invoices" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "qb_event" ON "qualified_beneficiaries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "qb_company_status" ON "qualified_beneficiaries" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "qe_company_status" ON "qualifying_events" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_modules_company_module" ON "setup_modules" USING btree ("company_id","module");--> statement-breakpoint
CREATE INDEX "tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_attempts_company_ip_at" ON "verification_attempts" USING btree ("company_id","ip","at");
-- Row-level security for tenant isolation (Cloud SQL).
--
-- Not part of the automatic migration chain yet. Today tenant scoping is
-- enforced in the application layer (every query in @cod/core filters by
-- company_id). Apply this once the app runtime connects as the non-owner
-- `cod_app` role and sets `app.company_id` per request transaction:
--
--   BEGIN; SELECT set_config('app.company_id', $1, true); ... COMMIT;
--
-- Jobs and ops tooling that work across tenants connect as `cod_ops`, which
-- bypasses these policies.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cod_app') THEN CREATE ROLE cod_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cod_ops') THEN CREATE ROLE cod_ops NOLOGIN BYPASSRLS; END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agreements','billing_accounts','company_users','coverages','dependents','documents',
    'e_delivery_consents','elections','employees','employer_charges','enrollee_accounts',
    'integrations','notices','payment_methods','payments','plans','premium_invoices',
    'qualified_beneficiaries','qualifying_events','setup_modules','verification_attempts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO cod_app USING (company_id = current_setting(''app.company_id'', true)) WITH CHECK (company_id = current_setting(''app.company_id'', true))',
      t
    );
  END LOOP;
END $$;

-- The audit log is append-only for the app role.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM cod_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM cod_app;

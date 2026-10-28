# COBRA on Demand

COBRA administration on demand for federal COBRA employers (20+ employees). Employers pay one flat rate per COBRA packet sent plus the same rate per active enrollee per month. Notices, elections, premium collection, grace periods and terminations run automatically from the employer's payroll or benefits data.

Built from the project's requirements docs: *Requirements & Coding Outline*, *COBRA on Demand Workflow*, *COBRA Packet Requirements: Federal + California* and *Integration Partners & API Requirements*. Requirement IDs (TRG-4, ENR-2, …) in code comments refer to those docs.

## Quick start

```bash
npm install
npm run db:seed      # synthetic demo data in .data/ (embedded Postgres, no setup)
npm run dev          # http://localhost:3000
```

The seed prints the sign-ins:

| Who | Where | Sign in |
| --- | --- | --- |
| Employer (Harbor Demo, live) | `/login` → `/dashboard` | `hr@harbor-demo.example` / `employer-dev-password` |
| Ops staff | `/login` → `/ops` | `ops@cobraondemand.local` / `ops-dev-password-2026` |
| Enrollee (Avery Chen) | `/e/harbor-demo` (or `harbor-demo.localhost:3000`) | termination date from the seed output, last 4 `1111`, DOB `1984-02-14`; the one-time code is shown on screen outside production |

Try the loop: on **Qualifying events**, use the sandbox panel to terminate another employee. The sync detects it and holds it for a one-tap confirmation; confirm it and the packet is generated and delivered (see **Ops → Outbox**). Set `COD_TODAY=YYYY-MM-DD` and run **Ops → Jobs** to move through invoices, grace periods and expirations.

```bash
npm test             # rules engine, notices, billing, integrations + full lifecycle on embedded Postgres
npm run typecheck
npm run build
npm run job -- all   # run every scheduled job once
```

## What's here

```
apps/web               Next.js 15 (App Router): marketing, employer app, enrollee portal, ops console, API
packages/rules         COBRA deadline + eligibility engine as config (federal + CA). Pure TS, heavily tested
packages/notices       Versioned notice templates, packet assembly per the CA checklist, PDF + QR rendering
packages/billing       Admin-editable price tiers, pricing calculator, double-entry ledger
packages/integrations  Canonical model, connector interface, census/plan CSV, sync diff → events, webhook HMAC, sandbox
packages/db            Drizzle schema + migrations, field encryption (SSN/DOB/EIN), document storage, RLS SQL
packages/core          Domain services: sign-up, setup hub, events, packets, enrollment, payments, jobs, dashboards
infra/gcp              One-time Google Cloud setup (bootstrap.sh) and custom domain + wildcard cert (domain.sh)
.github/workflows      CI (typecheck, tests, build, container) and keyless deploy to Cloud Run
```

### Implemented

- **Marketing + onboarding**: landing, pricing, cost calculator (MKT-1/2), short sign-up with the 20+ employee test (ONB-1/7), clickwrap Terms, Service Agreement and BAA recorded with signer, authority, version, IP and hash (ONB-6).
- **Setup hub** (SET-1…10): module cards with status and source; a source prompt per module; sandbox connector (the stand-in for Finch / Employee Navigator); census and rate-sheet CSV upload with row-level errors; manual plans with total monthly rates by tier; validation per module (PLN-9); automation settings (send now vs hold with auto-proceed, default company-paid COBRA); go-live, which emails the e-delivery consent request to every employee (NOT-9).
- **Termination trigger** (TRG-1…14, QE-1/2): sync diff detects terminations, rehires and reductions in hours; coverage snapshot frozen at the event (INT-15); no-coverage events are logged with no charge; hold-and-confirm with auto-proceed never past the send-by date; future-dated, backdated and late events; reversals; gross misconduct needs a reason and a second confirmation; manual reporting for death, divorce, aging out and Medicare.
- **Packets** (NOT-1…7, NOT-13): one packet per address, built from the checklist (cover letter, election notice, election form, rate sheet, Labor Code 2800.2 notice with its exact statement, HIPP, Marketplace/Medicare, AB 1401 extension, extension rights, separate-address notice) or a notice of unavailability; PDF with QR code, SHA-256, 7-year retention; email only with affirmative consent, otherwise automatic print-and-mail plus the manual administration fee; per-packet fee when sent.
- **Enrollee portal** (ENR-1…7, mobile-first): term date + employee last 4 + own DOB + one-time code, rate-limited; inline notice with scroll-to-acknowledge (receipt, not agreement); per-person, per-plan elect/waive with live tier pricing at 100%; CA and Marketplace notices required before submitting; e-signature with confirmation number; account, ACH/card (test tokens), autopay, invoices, free paper copy request.
- **Money**: initial premium back to the loss of coverage due in 45 days; monthly invoices; 30-day grace; the lesser-of-$50-or-10% shortfall rule with a 30-day cure; company-paid subsidy split; ledger postings; per-enrollee employer fees.
- **Jobs** (idempotent, `/api/jobs/{name}` with `CRON_SECRET`): send notices + ops alerts 2 days before deadlines, close election windows, initial-premium check, invoices + autopay, grace period, max-coverage warnings/ends, employer billing.
- **Employer dashboard** (section 8): time-frame picker, tiles, premium billed/collected/outstanding/subsidy, trend, pending elections, watch list, countdowns, enrollee table with filter and CSV export, billing by month.
- **Ops console** (OPS-1/2/4/5): exception queue with required resolution notes, companies, search, outbox, pricing tiers (validated and audited), job runner, append-only audit log.

### Not yet built (next steps)

| Area | Status |
| --- | --- |
| Payroll/ben-admin connectors | Connector interface, webhook verification and sandbox are done; Finch and Employee Navigator adapters wait on partner access (INT-1). |
| Payments | Stripe isn't wired: payment methods and charges record test tokens. Card/bank numbers are never collected by our forms. |
| Email / SMS / mail | Messages are recorded in the outbox; Postmark/SendGrid, Twilio and Lob adapters plug into `packages/core/src/messaging.ts` once BAAs are signed. |
| Auth | Password sessions (signed cookies). Identity Platform with MFA (ONB-2) replaces this before go-live. |
| Tenant isolation | Every query is scoped by `company_id` in the app layer. Postgres RLS policies are written (`packages/db/sql/rls.sql`) but turn on once requests set `app.company_id` and run as the non-owner role. |
| Broker access (7a), user invites, takeover file import, remittance payouts, carrier write-back / EDI 834, Spanish notices, native app, advanced reporting, multi-state | Not started; the data model leaves room for them. |

### Needs a human decision or review

- ERISA counsel review of every notice template (`packages/notices/src/templates.ts`), the agreements (`packages/core/src/agreements.ts`) and the ruleset (`packages/rules/src/config.ts`). The HIPP notice needs the official DHCS text inserted.
- Manual administration fee amount (placeholder $25, `MANUAL_ADMIN_FEE_CENTS`), volume tier prices, and the default hold days before auto-send (3).
- The open decisions listed in the requirements outline: remittance model, Finch vs Merge, TPA licensing, and the CA Administrator Certificate number shown in the footer.

## Deploying to Google Cloud

Staging runs on Cloud Run + Cloud SQL (Postgres 16) + Cloud Storage, with Secret Manager for keys and Cloud Scheduler for the deadline jobs. Use synthetic data only until the Google Cloud HIPAA BAA (and vendor BAAs) are signed.

1. **Project.** Create a Google Cloud project with billing enabled (owner access). Accept the HIPAA BAA in the console before any real employee data.
2. **Bootstrap (once).** In [Cloud Shell](https://shell.cloud.google.com):
   ```bash
   git clone https://github.com/piermarketing/COBRAonDemand.git && cd COBRAonDemand
   PROJECT_ID=your-project-id bash infra/gcp/bootstrap.sh
   ```
   It prints seven `GCP_*` values. Add them as GitHub repository variables (not secrets; the script prints `gh` commands that do it).
3. **Deploy.** GitHub → Actions → **Deploy** → Run workflow, ticking *seed demo data* the first time. Later pushes to `main` deploy automatically. The run summary shows the URL; the ops and employer passwords are in Secret Manager (`cod-seed-ops-password`, `cod-seed-employer-password`). Outside development the one-time code isn't shown on screen; read it in **Ops → Outbox** until email is connected.
4. **Domain.** In Cloud Shell: `PROJECT_ID=… DOMAIN=cobraondemand.com bash infra/gcp/domain.sh`. Add the A, wildcard A and CNAME records it prints at your DNS provider. When the certificate is ACTIVE, add the repository variable `APP_DOMAIN` and re-run Deploy; enrollee links switch to `{company}.cobraondemand.com`.

## Configuration

See `.env.example`. Production requires `FIELD_ENCRYPTION_KEY`, `SESSION_SECRET` and `CRON_SECRET`, and refuses to start without them. No real employee data belongs in this repo, its fixtures or dev databases (GH-7).

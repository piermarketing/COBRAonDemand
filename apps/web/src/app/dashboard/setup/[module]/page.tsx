import Link from "next/link";
import { notFound } from "next/navigation";
import { AGREEMENTS, setupOverview, validateModule } from "@cod/core";
import { SETUP_MODULES, type SetupModule } from "@cod/db";
import { PROVIDERS } from "@cod/integrations";
import { PLAN_TYPES, TIER_LABELS, TIERS } from "@cod/rules";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { UploadForm } from "@/components/upload-form";
import { requireEmployer } from "@/lib/auth";
import { setupData } from "@/lib/data";
import { date, dateTime, humanize, money } from "@/lib/format";
import {
  addBillingAction,
  confirmModuleAction,
  connectSandboxAction,
  currentCobraAction,
  savePlanAction,
  saveProfileAction,
  saveSettingsAction,
  uploadCensusAction,
  uploadPlansAction,
} from "../../actions";
import { GoLiveButton } from "../go-live";
import { MODULE_INFO } from "../modules";

type Data = Awaited<ReturnType<typeof setupData>>;

function SourcePrompt({ data, module }: { data: Data; module: SetupModule }) {
  const connected = new Set(data.integrations.map((i) => i.provider));
  const providers = [...PROVIDERS].filter((p) => p.provider !== "census_upload").sort((a, b) => Number(connected.has(b.provider)) - Number(connected.has(a.provider)));
  return (
    <Card title={module === "plans" ? "Where should we get your plan information?" : "Where should we get this data?"}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-ink">Connect a payroll, benefits or HR platform</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {providers.map((p) => (
              <div key={p.provider} className="flex items-start justify-between gap-3 rounded-md border border-line p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{p.displayName}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{p.notes}</p>
                </div>
                {connected.has(p.provider) ? (
                  <Badge tone="ok">Connected</Badge>
                ) : p.status === "available" ? (
                  <ActionForm action={connectSandboxAction} className="">
                    <SubmitButton variant="secondary" pending="Connecting…">
                      Connect
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <Badge>Partner access pending</Badge>
                )}
              </div>
            ))}
          </div>
          {connected.size > 0 && <p className="mt-2 text-xs text-ink-muted">Your connection fills employees, dependents, plans and elections at once.</p>}
        </div>
        {module === "plans" ? (
          <UploadForm action={uploadPlansAction} name="plans" label="Or upload a carrier rate sheet (CSV)" templateHref="/api/templates/plans" />
        ) : (
          <UploadForm action={uploadCensusAction} name="census" label="Or upload a census file (CSV): employees, dependents and elections in one file" templateHref="/api/templates/census" />
        )}
      </div>
    </Card>
  );
}

function ConfirmBar({ module, check }: { module: SetupModule; check: { ok: boolean; issues: string[] } }) {
  return (
    <Card title="Review">
      {check.issues.length > 0 ? (
        <ul className="mb-4 space-y-1 text-sm">
          {check.issues.map((i) => (
            <li key={i} className={i.includes("will be mailed") ? "text-warn" : "text-danger"}>
              • {i}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ok">Everything needed is here.</p>
      )}
      <ActionForm action={confirmModuleAction.bind(null, module)}>
        <SubmitButton>Confirm {MODULE_INFO[module].title.toLowerCase()}</SubmitButton>
      </ActionForm>
    </Card>
  );
}

function ProfileForm({ company }: { company: Awaited<ReturnType<typeof requireEmployer>>["company"] }) {
  return (
    <Card title="Company profile">
      <ActionForm action={saveProfileAction} className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name"><Input name="legalName" defaultValue={company.legalName} required /></Field>
        <Field label="DBA (optional)"><Input name="dba" defaultValue={company.dba ?? ""} /></Field>
        <Field label="EIN" hint={company.einEnc ? "On file (encrypted). Enter again to change." : "Stored encrypted."}><Input name="ein" placeholder="12-3456789" required={!company.einEnc} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={company.phone ?? ""} required /></Field>
        <Field label="Street address"><Input name="addressLine1" defaultValue={company.addressLine1 ?? ""} required /></Field>
        <div className="grid grid-cols-[1fr_80px_110px] gap-2">
          <Field label="City"><Input name="city" defaultValue={company.city ?? ""} required /></Field>
          <Field label="State"><Input name="state" defaultValue={company.state} maxLength={2} required /></Field>
          <Field label="ZIP"><Input name="postalCode" defaultValue={company.postalCode ?? ""} required /></Field>
        </div>
        <Field label="Employees in prior calendar year" hint="On 50%+ of typical business days. Decides federal COBRA."><Input name="priorYearEmployeeCount" type="number" min={0} defaultValue={company.priorYearEmployeeCount ?? ""} required /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Benefit-eligible"><Input name="benefitEligibleCount" type="number" min={0} defaultValue={company.benefitEligibleCount ?? ""} required /></Field>
          <Field label="Benefit-enrolled"><Input name="benefitEnrolledCount" type="number" min={0} defaultValue={company.benefitEnrolledCount ?? ""} required /></Field>
        </div>
        <Field label="Plan name (as shown on notices)"><Input name="planName" defaultValue={company.planName ?? ""} required /></Field>
        <Field label="Plan year start"><Input name="planYearStart" type="date" defaultValue={company.planYearStart ?? ""} required /></Field>
        <Field label="Plan administrator"><Input name="planAdministratorName" defaultValue={company.planAdministratorName ?? company.legalName} required /></Field>
        <Field label="ERISA plan number (optional)"><Input name="erisaPlanNumber" defaultValue={company.erisaPlanNumber ?? ""} /></Field>
        <Field label="HR contact name"><Input name="hrContactName" defaultValue={company.hrContactName ?? ""} required /></Field>
        <Field label="HR contact email"><Input name="hrContactEmail" type="email" defaultValue={company.hrContactEmail ?? ""} required /></Field>
        <Field label="HR contact phone"><Input name="hrContactPhone" defaultValue={company.hrContactPhone ?? ""} /></Field>
        <div className="sm:col-span-2"><SubmitButton>Save company profile</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

function PlanForm() {
  return (
    <Card title="Add a plan manually">
      <ActionForm action={savePlanAction} className="grid gap-4 sm:grid-cols-3">
        <Field label="Carrier"><Input name="carrierName" required /></Field>
        <Field label="Plan name"><Input name="name" required /></Field>
        <Field label="Plan code" hint="Must match the census file."><Input name="code" /></Field>
        <Field label="Type">
          <Select name="type" defaultValue="medical">
            {PLAN_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </Select>
        </Field>
        <Field label="Group number"><Input name="groupNumber" /></Field>
        <Field label="Funding">
          <Select name="funding" defaultValue="insured"><option value="insured">Insured</option><option value="self">Self-funded</option></Select>
        </Field>
        <Field label="Coverage ends">
          <Select name="coverageEndRule" defaultValue="end_of_month"><option value="end_of_month">End of the termination month</option><option value="termination_date">On the termination date</option></Select>
        </Field>
        {TIERS.map((t) => (
          <Field key={t} label={`${TIER_LABELS[t]} ($/month total)`} hint={t === "employee" ? "Employer + employee share, not the deduction." : undefined}>
            <Input name={`rate_${t}`} inputMode="decimal" placeholder="0.00" />
          </Field>
        ))}
        <div className="sm:col-span-3"><SubmitButton>Save plan</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: raw } = await params;
  if (!(SETUP_MODULES as readonly string[]).includes(raw)) notFound();
  const module = raw as SetupModule;
  const { company } = await requireEmployer();
  const data = await setupData(company.id);
  const check = await validateModule(company.id, module);
  const overview = await setupOverview(company.id);
  const row = overview.modules[module];
  const info = MODULE_INFO[module];
  const planById = new Map(data.plans.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/setup" className="text-sm text-brand">← Setup</Link>
        <PageHeader title={info.title} subtitle={info.body} action={row ? <Badge tone={row.status === "complete" ? "ok" : row.status === "needs_review" ? "warn" : "neutral"}>{humanize(row.status)}</Badge> : null} />
      </div>

      {module === "company_profile" && <ProfileForm company={company} />}

      {(module === "employees" || module === "dependents" || module === "elections" || module === "plans") && <SourcePrompt data={data} module={module} />}

      {module === "employees" && (
        <Card title={`Employees (${data.employees.length})`}>
          <Table
            headers={["Name", "Status", "Hire date", "Termination", "Email", "City"]}
            rows={data.employees.map((e) => [`${e.firstName} ${e.lastName}`, <Badge key="s" tone={e.status === "active" ? "ok" : "neutral"}>{e.status}</Badge>, date(e.hireDate), date(e.terminationDate), e.email ?? <span className="text-warn">none (mail)</span>, `${e.address.city}, ${e.address.state}`])}
            empty="No employees yet. Connect a platform or upload a census."
          />
        </Card>
      )}

      {module === "dependents" && (
        <Card title={`Dependents (${data.dependents.length})`}>
          <Table
            headers={["Name", "Relationship", "Employee", "Own address"]}
            rows={data.dependents.map((d) => {
              const e = data.employees.find((x) => x.id === d.employeeId);
              return [`${d.firstName} ${d.lastName}`, humanize(d.relationship), e ? `${e.firstName} ${e.lastName}` : "—", d.address ? `${d.address.line1}, ${d.address.city}` : "Same as employee"];
            })}
            empty="No dependents imported. If none of your employees cover family members, you can confirm this module as is."
          />
        </Card>
      )}

      {module === "plans" && (
        <>
          <Card title={`Plans (${data.plans.length})`}>
            <Table
              headers={["Plan", "Carrier", "Type", "COBRA", ...TIERS.map((t) => TIER_LABELS[t])]}
              rows={data.plans.map((p) => [
                <span key="n"><span className="font-medium text-ink">{p.name}</span><br /><span className="text-xs text-ink-muted">{p.code}{p.insured ? "" : " · self-funded"}</span></span>,
                p.carrierName,
                humanize(p.type),
                p.cobraEligible ? <Badge key="c" tone="ok">Eligible</Badge> : <Badge key="c">Not COBRA</Badge>,
                ...TIERS.map((t) => {
                  const r = data.rates.filter((x) => x.planId === p.id && x.tier === t).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
                  return r ? money(r.monthlyCost) : "—";
                }),
              ])}
              empty="No plans yet."
            />
            <p className="mt-3 text-xs text-ink-muted">COBRA premiums are 100% of the total monthly cost shown. Life and disability plans are kept but not offered to enrollees.</p>
          </Card>
          <PlanForm />
        </>
      )}

      {module === "elections" && (
        <Card title={`Current elections (${data.coverages.length})`}>
          <Table
            headers={["Person", "Plan", "Tier", "Since"]}
            rows={data.coverages.map((c) => {
              const e = data.employees.find((x) => x.id === c.employeeId);
              const d = c.dependentId ? data.dependents.find((x) => x.id === c.dependentId) : null;
              return [d ? `${d.firstName} ${d.lastName} (${d.relationship})` : `${e?.firstName} ${e?.lastName}`, planById.get(c.planId)?.name ?? "—", TIER_LABELS[c.tier], date(c.startDate)];
            })}
            empty="No elections yet."
          />
        </Card>
      )}

      {module === "current_cobra" && (
        <Card title="Do you have people on COBRA today?">
          <ActionForm action={currentCobraAction} className="space-y-3">
            <label className="flex gap-2 text-sm"><input type="radio" name="choice" value="none" defaultChecked /> No, nobody is on COBRA with another administrator.</label>
            <label className="flex gap-2 text-sm"><input type="radio" name="choice" value="takeover" /> Yes, we&apos;ll send the prior administrator&apos;s file (paid-through dates and months left).</label>
            <Field label="Notes (optional)"><Input name="notes" placeholder="Prior administrator, number of enrollees" /></Field>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {module === "admin_users" && (
        <Card title="Admin users">
          <Table headers={["Name", "Email", "Role", "Confirms terminations"]} rows={data.users.map((u) => [u.name, u.email, humanize(u.role), u.confirms ? "Yes" : "No"])} />
          <p className="mt-3 text-xs text-ink-muted">Inviting more users (owner, HR, billing-only, read-only) and broker access are next on the roadmap.</p>
        </Card>
      )}

      {module === "billing" && (
        <Card title="Who pays COBRA on Demand fees?">
          {data.billing?.paymentMethodStatus === "on_file" ? (
            <Alert tone="ok" title="Payment method on file">{data.billing.paymentMethodSummary}</Alert>
          ) : (
            <ActionForm action={addBillingAction}>
              <p className="text-sm text-ink-soft">The employer pays by default. Card or ACH through Stripe; we never see the full number. Nothing is charged until the first packet is sent.</p>
              <SubmitButton>Add payment method (Stripe test mode)</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-3 text-xs text-ink-muted">Broker-paid billing (a secure payment link to your broker) is coming next.</p>
        </Card>
      )}

      {module === "automation" && (
        <Card title="Automation">
          <ActionForm action={saveSettingsAction} className="space-y-4">
            <Field label="When a termination is detected">
              <Select name="sendMode" defaultValue={company.settings.sendMode}>
                <option value="hold">Hold for a one-tap confirmation, then send automatically</option>
                <option value="immediate">Send the packet right away</option>
              </Select>
            </Field>
            <Field label="Days to hold before sending automatically" hint="Never past the legal deadline; packets close to it go out immediately.">
              <Input name="autoProceedDays" type="number" min={0} max={10} defaultValue={company.settings.autoProceedDays} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company-paid COBRA: months" hint="Default for new events; 0 for none.">
                <Input name="subsidyMonths" type="number" min={0} max={18} defaultValue={company.settings.defaultSubsidy?.months ?? 0} />
              </Field>
              <Field label="Company-paid share (%)">
                <Input name="subsidyPercent" type="number" min={0} max={100} defaultValue={company.settings.defaultSubsidy?.percent ?? 0} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remindersEnabled" defaultChecked={company.settings.remindersEnabled} /> Send payment reminders to enrollees</label>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {module === "review" && (
        <Card title="Review and go live">
          <ul className="space-y-1 text-sm text-ink-soft">
            <li>Employees: {data.employees.length} · Dependents: {data.dependents.length} · Plans: {data.plans.length} · Elections: {data.coverages.length}</li>
            <li>Federal COBRA: {company.regime === "federal" ? "yes" : "no"}{company.stateExtensionApplies ? " · Cal-COBRA extension described in notices" : ""}</li>
          </ul>
          <h3 className="mt-4 text-sm font-semibold text-ink">Agreements</h3>
          <Table
            headers={["Agreement", "Version", "Signed by", "When"]}
            rows={data.agreements.map((a) => [AGREEMENTS.find((x) => x.type === a.type)?.title ?? a.type, a.version, `${a.signerName}, ${a.signerTitle}`, dateTime(a.signedAt)])}
          />
          <div className="mt-4">{company.status === "onboarding" ? <GoLiveButton disabled={!overview.canGoLive} /> : <Badge tone="ok">Live</Badge>}</div>
        </Card>
      )}

      {["employees", "dependents", "plans", "elections", "company_profile"].includes(module) && row?.status !== "complete" && <ConfirmBar module={module} check={check} />}
      {row?.status === "complete" && <p className="text-sm text-ok">Confirmed {dateTime(row.completedAt)}.</p>}
    </div>
  );
}

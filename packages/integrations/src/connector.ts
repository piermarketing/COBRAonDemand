import type {
  CanonicalDependent,
  CanonicalEmployee,
  CanonicalEmployer,
  CanonicalEnrollment,
  CanonicalPlan,
  DetectedEvent,
  SourceType,
} from "./canonical";

/** Connector interface every source implements (INT-10). */
export interface Connector {
  readonly provider: string;
  readonly displayName: string;
  readonly sourceType: SourceType;
  authorize(params: Record<string, string>): Promise<{ connectionId: string }>;
  getEmployer(): Promise<CanonicalEmployer>;
  listEmployees(since?: string): Promise<CanonicalEmployee[]>;
  getEmployee(id: string): Promise<CanonicalEmployee | undefined>;
  listDependents(): Promise<CanonicalDependent[]>;
  listEnrollments(): Promise<CanonicalEnrollment[]>;
  listPlans(): Promise<CanonicalPlan[]>;
  handleWebhook(req: { headers: Record<string, string | undefined>; body: string }): Promise<DetectedEvent[]>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}

export class ConnectorNotConfiguredError extends Error {
  constructor(provider: string, needs: string) {
    super(`${provider} is not configured yet: ${needs}`);
    this.name = "ConnectorNotConfiguredError";
  }
}

export interface ProviderInfo {
  provider: string;
  displayName: string;
  sourceType: SourceType;
  via: "finch" | "direct" | "file" | "sandbox";
  status: "available" | "partner_access_pending";
  notes: string;
}

/** Target platforms from the integration partners doc, in priority order. */
export const PROVIDERS: ProviderInfo[] = [
  { provider: "sandbox", displayName: "Sandbox (synthetic data)", sourceType: "payroll", via: "sandbox", status: "available", notes: "Synthetic employees, plans and elections for testing the full loop." },
  { provider: "employee_navigator", displayName: "Employee Navigator", sourceType: "ben_admin", via: "direct", status: "partner_access_pending", notes: "Pilot ben-admin integration. Partner API access requested; census/plan exports work today through census upload." },
  { provider: "gusto", displayName: "Gusto", sourceType: "payroll", via: "finch", status: "partner_access_pending", notes: "Webhooks: employee.terminated, termination_cancelled, rehired." },
  { provider: "adp_wfn", displayName: "ADP Workforce Now / RUN", sourceType: "payroll", via: "finch", status: "partner_access_pending", notes: "OAuth client credentials + mutual TLS." },
  { provider: "paychex", displayName: "Paychex Flex", sourceType: "payroll", via: "finch", status: "partner_access_pending", notes: "Strong in 2–50 employee groups." },
  { provider: "paylocity", displayName: "Paylocity", sourceType: "payroll", via: "finch", status: "partner_access_pending", notes: "Thin termination webhook; follow up with a GET." },
  { provider: "rippling", displayName: "Rippling", sourceType: "payroll", via: "finch", status: "partner_access_pending", notes: "Sells its own COBRA admin." },
  { provider: "bamboohr", displayName: "BambooHR", sourceType: "hr_platform", via: "finch", status: "partner_access_pending", notes: "HMAC-signed permissioned webhooks; reconcile daily." },
  { provider: "noyo", displayName: "Noyo", sourceType: "ben_admin", via: "direct", status: "partner_access_pending", notes: "Coverage export and member premiums." },
  { provider: "census_upload", displayName: "Census file upload (CSV)", sourceType: "census_upload", via: "file", status: "available", notes: "Template upload with row-level validation." },
];

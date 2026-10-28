import { todayIso, type IsoDate } from "@cod/rules";

/**
 * Runtime configuration. COD_TODAY lets dev and test environments move the
 * clock to exercise deadlines and jobs; it is ignored in production.
 */
export function today(): IsoDate {
  const override = process.env.COD_TODAY;
  if (override && process.env.NODE_ENV !== "production") return override;
  return todayIso();
}

export const isProduction = () => process.env.NODE_ENV === "production";

/** Root domain; employers get {slug}.{root} (SET-11). */
export function rootDomain(): string {
  return process.env.APP_ROOT_DOMAIN ?? "cobraondemand.com";
}

/** Base URL of the app in development (path-based enrollee portal). */
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

/** company.cobraondemand.com once the wildcard domain is live (ENROLLEE_SUBDOMAINS=true); otherwise {APP_BASE_URL}/e/{slug}. */
export function enrolleeUrl(slug: string): string {
  if (process.env.ENROLLEE_SUBDOMAINS === "true") return `https://${slug}.${rootDomain()}`;
  return `${appBaseUrl()}/e/${slug}`;
}

export const ADMINISTRATOR = {
  name: process.env.ADMINISTRATOR_NAME ?? "COBRA on Demand",
  addressLines: (process.env.ADMINISTRATOR_ADDRESS ?? "PO Box 0000|Long Beach, CA 90802").split("|"),
  phone: process.env.ADMINISTRATOR_PHONE ?? "(800) 555-0199",
  email: process.env.ADMINISTRATOR_EMAIL ?? "help@cobraondemand.com",
  website: process.env.ADMINISTRATOR_WEBSITE ?? "cobraondemand.com",
  /** California Administrator Certificate number, shown in the footer and agreements (ONB-6). */
  caAdministratorCertificate: process.env.CA_ADMINISTRATOR_CERTIFICATE ?? "pending",
};

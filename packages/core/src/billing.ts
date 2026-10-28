import { and, eq } from "drizzle-orm";
import { getDb, tables } from "@cod/db";
import { DEFAULT_MANUAL_ADMIN_FEE, LAUNCH_PRICE_TIERS, unitPriceFor, type Posting, type PriceTier } from "@cod/billing";
import { today } from "./env";

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

export async function activePriceTiers(): Promise<PriceTier[]> {
  const db = await getDb();
  const rows = await db.select().from(tables.priceTiers).where(and(eq(tables.priceTiers.active, true), eq(tables.priceTiers.plan, "standard")));
  if (rows.length === 0) return LAUNCH_PRICE_TIERS;
  return rows.map((r) => ({ min: r.min, max: r.max, unitPrice: r.unitPrice, plan: r.plan })).sort((a, b) => a.min - b.min);
}

export function manualAdminFee(): number {
  return Number(process.env.MANUAL_ADMIN_FEE_CENTS ?? DEFAULT_MANUAL_ADMIN_FEE);
}

/**
 * Record a billable event for the employer. The per-packet fee is charged
 * when the packet is sent (TRG-14); enrollee months are charged by the
 * monthly employer-billing job. Rates come from admin-editable price tiers.
 */
export async function recordEmployerCharge(
  companyId: string,
  type: "packet" | "enrollee_month" | "manual_admin",
  quantity: number,
  ref: { type: string; id: string },
  period = today().slice(0, 7),
) {
  const db = await getDb();
  const unitPrice = type === "manual_admin" ? manualAdminFee() : unitPriceFor(await activePriceTiers(), quantity);
  const [row] = await db
    .insert(tables.employerCharges)
    .values({ companyId, type, quantity, unitPrice, amount: unitPrice * quantity, period, refType: ref.type, refId: ref.id })
    .returning();
  await postLedger(companyId, {
    refType: "employer_charge",
    refId: row!.id,
    memo: `${type} fee`,
    lines: [
      { account: "fees_receivable", debit: row!.amount, credit: 0 },
      { account: "fee_revenue", debit: 0, credit: row!.amount },
    ],
  });
  return row!;
}

export async function postLedger(companyId: string | null, posting: Posting, tx?: Tx) {
  const db = tx ?? (await getDb());
  const postingId = crypto.randomUUID();
  if (posting.lines.length === 0) return;
  await db.insert(tables.ledgerEntries).values(
    posting.lines
      .filter((l) => l.debit > 0 || l.credit > 0)
      .map((l) => ({ postingId, companyId, account: l.account, debit: l.debit, credit: l.credit, refType: posting.refType, refId: posting.refId, memo: posting.memo })),
  );
}

export async function employerBillingSummary(companyId: string) {
  const db = await getDb();
  const charges = await db.select().from(tables.employerCharges).where(eq(tables.employerCharges.companyId, companyId));
  const byPeriod = new Map<string, { period: string; packets: number; enrolleeMonths: number; manual: number; total: number }>();
  for (const c of charges) {
    const p = byPeriod.get(c.period) ?? { period: c.period, packets: 0, enrolleeMonths: 0, manual: 0, total: 0 };
    if (c.type === "packet") p.packets += c.quantity;
    if (c.type === "enrollee_month") p.enrolleeMonths += c.quantity;
    if (c.type === "manual_admin") p.manual += c.quantity;
    p.total += c.amount;
    byPeriod.set(c.period, p);
  }
  return [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period));
}

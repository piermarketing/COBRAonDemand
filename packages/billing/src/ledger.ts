import type { Cents } from "@cod/rules";

/**
 * Double-entry ledger (BIL-7). Every premium, fee, payout and refund is posted
 * as a balanced set of entries that is never edited; corrections are new
 * reversing entries.
 */

export const LEDGER_ACCOUNTS = [
  "cash_trust", // premiums held in trust for remittance
  "cash_operating", // COBRA on Demand's own fees
  "premiums_receivable",
  "premiums_payable", // owed to employer or carrier
  "employer_subsidy_receivable",
  "fees_receivable",
  "fee_revenue",
  "refunds_payable",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export interface LedgerLine {
  account: LedgerAccount;
  debit: Cents;
  credit: Cents;
}

export interface Posting {
  refType: string;
  refId: string;
  memo: string;
  lines: LedgerLine[];
}

export function assertBalanced(posting: Posting): void {
  let debits = 0;
  let credits = 0;
  for (const line of posting.lines) {
    if (line.debit < 0 || line.credit < 0) throw new Error("Ledger amounts must be non-negative");
    if (line.debit > 0 && line.credit > 0) throw new Error("A ledger line is either a debit or a credit");
    if (!Number.isInteger(line.debit) || !Number.isInteger(line.credit)) throw new Error("Ledger amounts must be whole cents");
    debits += line.debit;
    credits += line.credit;
  }
  if (posting.lines.length < 2) throw new Error("A posting needs at least two lines");
  if (debits !== credits) throw new Error(`Unbalanced posting ${posting.refType}:${posting.refId} (${debits} ≠ ${credits})`);
}

const dr = (account: LedgerAccount, amount: Cents): LedgerLine => ({ account, debit: amount, credit: 0 });
const cr = (account: LedgerAccount, amount: Cents): LedgerLine => ({ account, debit: 0, credit: amount });

/** Invoice a monthly premium: the enrollee share and any employer subsidy become receivable. */
export function premiumInvoicedPosting(invoiceId: string, enrolleeShare: Cents, employerSubsidy: Cents): Posting {
  const lines: LedgerLine[] = [];
  if (enrolleeShare > 0) lines.push(dr("premiums_receivable", enrolleeShare));
  if (employerSubsidy > 0) lines.push(dr("employer_subsidy_receivable", employerSubsidy));
  lines.push(cr("premiums_payable", enrolleeShare + employerSubsidy));
  const posting = { refType: "premium_invoice", refId: invoiceId, memo: "Premium invoiced", lines };
  assertBalanced(posting);
  return posting;
}

export function premiumPaymentPosting(paymentId: string, amount: Cents): Posting {
  const posting = {
    refType: "payment",
    refId: paymentId,
    memo: "Premium received into trust",
    lines: [dr("cash_trust", amount), cr("premiums_receivable", amount)],
  };
  assertBalanced(posting);
  return posting;
}

export function remittancePosting(remittanceId: string, amount: Cents): Posting {
  const posting = {
    refType: "remittance",
    refId: remittanceId,
    memo: "Premiums remitted",
    lines: [dr("premiums_payable", amount), cr("cash_trust", amount)],
  };
  assertBalanced(posting);
  return posting;
}

export function employerFeePosting(chargeId: string, amount: Cents): Posting {
  const posting = {
    refType: "employer_charge",
    refId: chargeId,
    memo: "COBRA on Demand fee",
    lines: [dr("fees_receivable", amount), cr("fee_revenue", amount)],
  };
  assertBalanced(posting);
  return posting;
}

/** Balance per account: debits minus credits. */
export function trialBalance(postings: Posting[]): Record<LedgerAccount, Cents> {
  const balances = Object.fromEntries(LEDGER_ACCOUNTS.map((a) => [a, 0])) as Record<LedgerAccount, Cents>;
  for (const p of postings) for (const l of p.lines) balances[l.account] += l.debit - l.credit;
  return balances;
}

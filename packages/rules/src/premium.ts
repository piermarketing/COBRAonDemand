import { COMPANY_POLICY, FEDERAL, STATES } from "./config";
import { addDays, addMonths, compareDates, daysBetween, endOfMonth, laterOf, parseIsoDate, startOfMonth, type IsoDate } from "./dates";
import { graceEnd } from "./deadlines";

/** All money in the engine is integer cents. */
export type Cents = number;

export function dollarsToCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function formatCents(cents: Cents): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type PremiumRegime = "federal" | "state_extension";

/** Highest premium the law allows (102% / 150%, or the state cap during a state extension). */
export function legalMaxPremium(totalMonthlyCost: Cents, opts: { disability?: boolean; regime?: PremiumRegime; state?: string } = {}): Cents {
  let multiplier = opts.disability ? FEDERAL.maxPremiumMultiplierDisability : FEDERAL.maxPremiumMultiplier;
  if (opts.regime === "state_extension" && opts.state && STATES[opts.state]) {
    const s = STATES[opts.state]!;
    multiplier = opts.disability ? s.maxPremiumMultiplierDisability : s.maxPremiumMultiplier;
  }
  return Math.round(totalMonthlyCost * multiplier);
}

/**
 * Monthly COBRA premium charged to the enrollee. Company policy is 100% of the
 * total plan cost (employer + employee share) with no admin fee (BIL-4).
 */
export function cobraMonthlyPremium(totalMonthlyCost: Cents, opts: { disability?: boolean } = {}): Cents {
  if (!Number.isInteger(totalMonthlyCost) || totalMonthlyCost < 0) {
    throw new Error("Total monthly cost must be a non-negative integer number of cents");
  }
  const multiplier = opts.disability ? COMPANY_POLICY.enrolleePremiumMultiplierDisability : COMPANY_POLICY.enrolleePremiumMultiplier;
  const premium = Math.round(totalMonthlyCost * multiplier);
  if (premium > legalMaxPremium(totalMonthlyCost, opts)) {
    throw new Error("Configured premium exceeds the legal maximum");
  }
  return premium;
}

export interface PremiumPeriod {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** Premiums are due on the first of each month. */
  dueDate: IsoDate;
  graceEnd: IsoDate;
  amount: Cents;
  prorated: boolean;
}

/**
 * Monthly premium periods from COBRA start through `through` (inclusive),
 * clamped to the maximum coverage end. A first month that starts mid-month,
 * and a last month that ends mid-month, are prorated by day.
 */
export function premiumPeriods(cobraStart: IsoDate, through: IsoDate, maxEnd: IsoDate, monthlyPremium: Cents): PremiumPeriod[] {
  const periods: PremiumPeriod[] = [];
  const last = compareDates(through, maxEnd) < 0 ? through : maxEnd;
  let monthStart = startOfMonth(cobraStart);
  while (compareDates(monthStart, last) <= 0) {
    const monthEnd = endOfMonth(monthStart);
    const periodStart = laterOf(monthStart, cobraStart);
    const periodEnd = compareDates(monthEnd, maxEnd) <= 0 ? monthEnd : maxEnd;
    const daysInMonth = parseIsoDate(monthEnd).getUTCDate();
    const coveredDays = daysBetween(periodStart, periodEnd) + 1;
    const prorated = coveredDays !== daysInMonth;
    const amount = prorated ? Math.round((monthlyPremium * coveredDays) / daysInMonth) : monthlyPremium;
    periods.push({ periodStart, periodEnd, dueDate: monthStart, graceEnd: graceEnd(monthStart), amount, prorated });
    monthStart = addMonths(monthStart, 1);
  }
  return periods;
}

/** The first payment covers every month from the loss of coverage through the month of election. */
export function initialPremiumAmount(cobraStart: IsoDate, electedOn: IsoDate, maxEnd: IsoDate, monthlyPremium: Cents): Cents {
  return premiumPeriods(cobraStart, electedOn, maxEnd, monthlyPremium).reduce((sum, p) => sum + p.amount, 0);
}

/**
 * A payment short by no more than the lesser of $50 or 10% of the amount due
 * counts as full payment, unless we notify the person and give 30 days to cure.
 */
export function isInsignificantShortfall(amountDue: Cents, amountPaid: Cents): boolean {
  const shortfall = amountDue - amountPaid;
  if (shortfall <= 0) return false;
  const threshold = Math.min(dollarsToCents(FEDERAL.shortfall.absolute), Math.floor(amountDue * FEDERAL.shortfall.percent));
  return shortfall <= threshold;
}

export type InvoiceStatus = "paid" | "due" | "in_grace" | "shortfall_cure" | "lapsed";

export interface InvoiceEvaluationInput {
  amountDue: Cents;
  dueDate: IsoDate;
  /** Last day a payment is timely: grace end for monthly premiums, day 45 for the initial premium. */
  finalPaymentDate: IsoDate;
  payments: { amount: Cents; paidOn: IsoDate }[];
  today: IsoDate;
}

export interface InvoiceEvaluation {
  status: InvoiceStatus;
  paidTimely: Cents;
  shortfall: Cents;
  /** Set when an insignificant shortfall is open: the cure notice deadline. */
  cureBy?: IsoDate;
}

export function evaluateInvoice(input: InvoiceEvaluationInput): InvoiceEvaluation {
  const timely = input.payments.filter((p) => compareDates(p.paidOn, input.finalPaymentDate) <= 0);
  const paidTimely = timely.reduce((sum, p) => sum + p.amount, 0);
  const shortfall = Math.max(0, input.amountDue - paidTimely);

  if (shortfall === 0) return { status: "paid", paidTimely, shortfall };

  if (paidTimely > 0 && isInsignificantShortfall(input.amountDue, paidTimely)) {
    const lastTimely = timely.map((p) => p.paidOn).sort().at(-1)!;
    const cureBy = addDays(lastTimely, FEDERAL.cureDays);
    const cured = input.payments
      .filter((p) => compareDates(p.paidOn, cureBy) <= 0)
      .reduce((sum, p) => sum + p.amount, 0) >= input.amountDue;
    if (cured) return { status: "paid", paidTimely, shortfall: 0 };
    if (compareDates(input.today, cureBy) <= 0) return { status: "shortfall_cure", paidTimely, shortfall, cureBy };
    return { status: "lapsed", paidTimely, shortfall, cureBy };
  }

  if (compareDates(input.today, input.dueDate) < 0) return { status: "due", paidTimely, shortfall };
  if (compareDates(input.today, input.finalPaymentDate) <= 0) {
    return { status: compareDates(input.today, input.dueDate) === 0 ? "due" : "in_grace", paidTimely, shortfall };
  }
  return { status: "lapsed", paidTimely, shortfall };
}

export interface SubsidySplit {
  employer: Cents;
  enrollee: Cents;
}

/**
 * Company-paid COBRA (QE-2): for the first `subsidyMonths` periods the
 * employer pays `subsidyPercent` of the premium and the enrollee the rest.
 */
export function splitSubsidy(premium: Cents, periodIndex: number, subsidy: { months: number; percent: number } | null): SubsidySplit {
  if (!subsidy || subsidy.months <= 0 || subsidy.percent <= 0 || periodIndex >= subsidy.months) {
    return { employer: 0, enrollee: premium };
  }
  const pct = Math.min(100, subsidy.percent);
  const employer = Math.round((premium * pct) / 100);
  return { employer, enrollee: premium - employer };
}

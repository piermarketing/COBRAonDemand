/**
 * Date-only arithmetic for legal deadlines.
 *
 * Every COBRA deadline is a calendar date, not an instant, so the engine works
 * on ISO `YYYY-MM-DD` strings and does all math in UTC to stay clear of
 * time-zone and daylight-saving drift.
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: IsoDate): Date {
  const m = ISO_RE.exec(value);
  if (!m) throw new Error(`Invalid ISO date: ${value}`);
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return date;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds calendar months, clamping to the last day of the target month
 * (Jan 31 + 1 month = Feb 28/29), which is how coverage periods are counted.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = parseIsoDate(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const clamped = Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
  target.setUTCDate(clamped);
  return toIsoDate(target);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function laterOf(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) >= 0 ? a : b;
}

export function earlierOf(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) <= 0 ? a : b;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const d = parseIsoDate(date);
  return toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function isWeekend(date: IsoDate): boolean {
  const dow = parseIsoDate(date).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * The regulations count calendar days and do not roll deadlines forward over
 * weekends, so the safe internal target is the last business day on or before
 * the legal deadline.
 */
export function lastBusinessDayOnOrBefore(date: IsoDate): IsoDate {
  let d = date;
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

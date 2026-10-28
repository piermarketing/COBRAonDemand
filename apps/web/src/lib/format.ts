import { formatCents, parseIsoDate } from "@cod/rules";

export const money = (cents: number | null | undefined) => formatCents(cents ?? 0);

export function date(iso: string | null | undefined, style: "long" | "short" = "short"): string {
  if (!iso) return "—";
  return parseIsoDate(iso.slice(0, 10)).toLocaleDateString("en-US", {
    year: "numeric",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

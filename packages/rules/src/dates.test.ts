import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  isIsoDate,
  isWeekend,
  lastBusinessDayOnOrBefore,
  parseIsoDate,
} from "./dates";

describe("dates", () => {
  it("rejects malformed and impossible dates", () => {
    expect(() => parseIsoDate("2026-13-01")).toThrow();
    expect(() => parseIsoDate("2026-02-30")).toThrow();
    expect(() => parseIsoDate("10/28/2026")).toThrow();
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds months and clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 18)).toBe("2028-02-29");
    expect(addMonths("2026-11-01", 18)).toBe("2028-05-01");
    expect(addMonths("2026-05-15", -6)).toBe("2025-11-15");
  });

  it("counts days between dates, including over DST changes", () => {
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-11-10", "2026-11-01")).toBe(-9);
  });

  it("finds the end of the month", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-04-01")).toBe("2026-04-30");
  });

  it("moves weekend deadlines back to Friday", () => {
    expect(isWeekend("2026-10-31")).toBe(true); // Saturday
    expect(lastBusinessDayOnOrBefore("2026-10-31")).toBe("2026-10-30");
    expect(lastBusinessDayOnOrBefore("2026-11-01")).toBe("2026-10-30");
    expect(lastBusinessDayOnOrBefore("2026-10-28")).toBe("2026-10-28");
  });
});

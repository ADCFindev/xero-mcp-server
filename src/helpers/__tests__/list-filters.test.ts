import { describe, expect, it } from "vitest";
import { dateConditions, isoDay, pageLine, pageSizeArgument, rangeProblem, statusCondition } from "../list-filters.js";

describe("list filters", () => {
  it("accepts only real calendar days as YYYY-MM-DD", () => {
    expect(isoDay.safeParse("2026-11-30").success).toBe(true);
    expect(isoDay.safeParse("2028-02-29").success).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "30.11.2026", "2026-11-3", "2026-11-30) OR (1==1", ""]) {
      expect(isoDay.safeParse(bad).success).toBe(false);
    }
  });

  it("writes Xero date conditions, both ends included", () => {
    expect(dateConditions("Date", "2026-11-01", "2026-11-30")).toEqual([
      "Date >= DateTime(2026, 11, 01)",
      "Date <= DateTime(2026, 11, 30)",
    ]);
    expect(dateConditions("Date")).toEqual([]);
    expect(dateConditions("Date", undefined, "2026-01-05")).toEqual(["Date <= DateTime(2026, 01, 05)"]);
  });

  it("joins several statuses with OR in brackets", () => {
    expect(statusCondition()).toBeNull();
    expect(statusCondition(["AUTHORISED"])).toBe('Status=="AUTHORISED"');
    expect(statusCondition(["AUTHORISED", "DELETED"])).toBe('(Status=="AUTHORISED" OR Status=="DELETED")');
  });

  it("refuses a range the wrong way round", () => {
    expect(rangeProblem("2026-11-30", "2026-11-01")).toMatch(/after toDate/);
    expect(rangeProblem("2026-11-01", "2026-11-01")).toBeNull();
    expect(rangeProblem(undefined, "2026-11-01")).toBeNull();
  });

  it("limits the page size to 1..100 whole records", () => {
    expect(pageSizeArgument.safeParse(100).success).toBe(true);
    expect(pageSizeArgument.safeParse(undefined).success).toBe(true);
    for (const bad of [0, 101, 2.5]) expect(pageSizeArgument.safeParse(bad).success).toBe(false);
  });

  it("prints the page, the page size and only the filters given", () => {
    expect(pageLine(1, 10, {})).toBe("Page 1, page size 10.");
    expect(pageLine(2, 100, { statuses: ["AUTHORISED", "DRAFT"], from: "2026-11-01", to: undefined, empty: [] }))
      .toBe("Page 2, page size 100. Filters: statuses AUTHORISED,DRAFT; from 2026-11-01.");
  });
});

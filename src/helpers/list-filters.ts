import { z } from "zod";

// Filters shared by the list tools (list-invoices, list-bank-transactions, list-payments): a status list, a date range and a
// page size. Every value goes into a Xero "where" expression only after it was checked here, so no caller text reaches it.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day as YYYY-MM-DD that exists (2026-02-30 is refused). */
export const isoDay = z
  .string()
  .refine((value) => {
    const m = ISO_DAY.exec(value);
    if (!m) return false;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return day.toISOString().slice(0, 10) === value;
  }, "Expected a date as YYYY-MM-DD");

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export const pageSizeArgument = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .optional()
  .describe(
    `Records per page, 1 to ${MAX_PAGE_SIZE} (default ${DEFAULT_PAGE_SIZE}). A page with fewer records than this is the last one.`,
  );

const xeroDay = (value: string) => {
  const [y, m, d] = value.split("-");
  return `DateTime(${y}, ${m}, ${d})`;
};

/** "Date >= DateTime(2026, 11, 01)" and "Date <= DateTime(2026, 11, 30)"; both ends included. */
export function dateConditions(field: string, fromDate?: string, toDate?: string): string[] {
  return [
    fromDate ? `${field} >= ${xeroDay(fromDate)}` : null,
    toDate ? `${field} <= ${xeroDay(toDate)}` : null,
  ].filter((c): c is string => c !== null);
}

/** One status, or several joined by OR in brackets. Statuses come from a fixed list (zod enum), never free text. */
export function statusCondition(statuses?: readonly string[]): string | null {
  if (!statuses?.length) return null;
  const parts = statuses.map((s) => `Status=="${s}"`);
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

/** An error text when the range is the wrong way round, else null. */
export function rangeProblem(fromDate?: string, toDate?: string): string | null {
  return fromDate && toDate && fromDate > toDate ? `fromDate ${fromDate} is after toDate ${toDate}` : null;
}

/**
 * The line printed under "Found N ...": the page, the page size and the filters the server applied. A caller that reads
 * every page uses it to know the page size really used (an older server ignores pageSize and the filters it does not
 * know, and does not print this line).
 */
export function pageLine(
  page: number,
  pageSize: number,
  filters: Record<string, string | readonly string[] | undefined>,
): string {
  const applied = Object.entries(filters)
    .filter(([, v]) => v !== undefined && (typeof v === "string" ? v !== "" : v.length > 0))
    .map(([k, v]) => `${k} ${typeof v === "string" ? v : (v as readonly string[]).join(",")}`);
  return `Page ${page}, page size ${pageSize}.${applied.length ? ` Filters: ${applied.join("; ")}.` : ""}`;
}

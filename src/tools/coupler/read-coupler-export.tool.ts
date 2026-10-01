import crypto from "node:crypto";
import { z } from "zod";

import { ToolDefinition } from "../../types/tool-definition.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_BYTES = 25 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;

type Row = Record<string, unknown>;
type CacheEntry = { rows: Row[]; columns: string[]; fetchedAt: number };

const cache = new Map<string, CacheEntry>();

/** Only Coupler.io JSON export links are fetched, to keep this from being a general proxy. */
export function validateCouplerUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "app.coupler.io" || !url.pathname.startsWith("/export/")) {
    throw new Error("Only Coupler.io JSON export links (https://app.coupler.io/export/...) are supported.");
  }
  return url;
}

/** Accepts the shapes Coupler and similar exports use: [..], {data:[..]}, {rows:[..]}, {columns,rows}. */
export function normaliseRows(body: unknown): Row[] {
  const asRows = (value: unknown): Row[] | null => {
    if (!Array.isArray(value)) return null;
    if (value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
      return value as Row[];
    }
    return null;
  };
  const direct = asRows(body);
  if (direct) return direct;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const columns = (obj.columns as unknown[]).map((c) =>
        typeof c === "string" ? c : String((c as any)?.name ?? (c as any)?.key ?? ""),
      );
      return (obj.rows as unknown[]).map((r) => {
        if (Array.isArray(r)) return Object.fromEntries(columns.map((c, i) => [c, r[i]]));
        return r as Row;
      });
    }
    for (const key of ["data", "rows", "records", "items", "result"]) {
      const nested = asRows(obj[key]);
      if (nested) return nested;
    }
  }
  throw new Error("The export did not contain a list of rows.");
}

async function loadExport(url: URL, refresh: boolean): Promise<CacheEntry> {
  const key = crypto.createHash("sha256").update(url.toString()).digest("hex");
  const cached = cache.get(key);
  if (!refresh && cached && cached.fetchedAt + CACHE_TTL_MS > Date.now()) return cached;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Coupler returned HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("The export is larger than 25 MB.");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("The export is larger than 25 MB.");

  const rows = normaliseRows(JSON.parse(text));
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }
  const entry = { rows, columns, fetchedAt: Date.now() };
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return entry;
}

const FilterSchema = z.object({
  column: z.string(),
  op: z
    .enum(["eq", "neq", "contains", "notContains", "gt", "gte", "lt", "lte", "empty", "notEmpty"])
    .default("eq"),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
type Filter = z.infer<typeof FilterSchema>;

function asComparable(value: unknown): number | string {
  if (typeof value === "number") return value;
  const text = value === null || value === undefined ? "" : String(value).trim();
  const numeric = Number(text.replace(/,/g, ""));
  if (text !== "" && !Number.isNaN(numeric) && /^-?[\d,]*\.?\d+$/.test(text)) return numeric;
  return text.toLowerCase();
}

export function matches(row: Row, filter: Filter): boolean {
  const raw = row[filter.column];
  const isEmpty = raw === null || raw === undefined || String(raw).trim() === "";
  if (filter.op === "empty") return isEmpty;
  if (filter.op === "notEmpty") return !isEmpty;
  const left = asComparable(raw);
  const right = asComparable(filter.value);
  switch (filter.op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "contains":
      return String(left).includes(String(right));
    case "notContains":
      return !String(left).includes(String(right));
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
  }
  return false;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/[\t\r\n]+/g, " ");
}

const ReadCouplerExportTool = (): ToolDefinition<any> => ({
  name: "read-coupler-export",
  description:
    "Read rows from a Coupler.io JSON export link (https://app.coupler.io/export/...), e.g. a Xero Bank Statement " +
    "dataflow with every bank statement line and its reconciled status. Call it first without filters to see the " +
    "columns, then filter (e.g. unreconciled lines in a date range) and page with offset/limit. Results are cached " +
    "for 5 minutes; pass refresh=true to fetch again.",
  schema: {
    url: z.string().describe("The Coupler.io JSON export URL, including its access_token."),
    filters: z
      .array(FilterSchema)
      .optional()
      .describe("All filters must match. Comparisons are case-insensitive; numbers and ISO dates compare naturally."),
    columns: z.array(z.string()).optional().describe("Only return these columns."),
    sortBy: z.string().optional().describe("Column to sort by (ascending unless sortDescending)."),
    sortDescending: z.boolean().optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(2000).optional().describe("Rows to return (default 200)."),
    format: z.enum(["table", "json"]).optional().describe("table (tab-separated, default) or json."),
    refresh: z.boolean().optional(),
  },
  handler: (async (args: {
    url: string;
    filters?: Filter[];
    columns?: string[];
    sortBy?: string;
    sortDescending?: boolean;
    offset?: number;
    limit?: number;
    format?: "table" | "json";
    refresh?: boolean;
  }) => {
    const text = (value: string, isError = false) => ({
      content: [{ type: "text" as const, text: value }],
      ...(isError ? { isError: true } : {}),
    });
    let data: CacheEntry;
    try {
      data = await loadExport(validateCouplerUrl(args.url), args.refresh === true);
    } catch (error) {
      return text(`Could not read the Coupler export: ${(error as Error).message}`, true);
    }

    const filters = args.filters ?? [];
    const unknown = [
      ...filters.map((f) => f.column),
      ...(args.columns ?? []),
      ...(args.sortBy ? [args.sortBy] : []),
    ].filter((c) => !data.columns.includes(c));
    if (unknown.length > 0) {
      return text(
        `Unknown column(s): ${[...new Set(unknown)].join(", ")}. Available columns: ${data.columns.join(", ")}`,
        true,
      );
    }

    let rows = data.rows.filter((row) => filters.every((f) => matches(row, f)));
    if (args.sortBy) {
      const column = args.sortBy;
      const direction = args.sortDescending ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const left = asComparable(a[column]);
        const right = asComparable(b[column]);
        return left < right ? -direction : left > right ? direction : 0;
      });
    }
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 200;
    const page = rows.slice(offset, offset + limit);
    const columns = args.columns?.length ? args.columns : data.columns;

    const header =
      `Export has ${data.rows.length} rows; ${rows.length} match the filters; showing ${page.length} ` +
      `(offset ${offset}). Fetched ${new Date(data.fetchedAt).toISOString()}.\nColumns: ${data.columns.join(", ")}`;
    if (args.format === "json") {
      const picked = page.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
      return text(`${header}\n\n${JSON.stringify(picked)}`);
    }
    const lines = [columns.join("\t"), ...page.map((row) => columns.map((c) => cell(row[c])).join("\t"))];
    const more = offset + page.length < rows.length ? `\n\n(${rows.length - offset - page.length} more; use offset ${offset + page.length})` : "";
    return text(`${header}\n\n${lines.join("\n")}${more}`);
  }) as any,
});

export default ReadCouplerExportTool;

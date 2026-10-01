import axios, { AxiosError } from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";
import {
  JournalFilter,
  LedgerLine,
  LedgerSummary,
  SourceDetail,
  SourceResource,
  XeroJournal,
  buildAccountMatcher,
  buildIdWhere,
  chunk,
  extractLedgerLines,
  groupSourceIds,
  isGuid,
  normaliseSourceTypes,
  shiftIsoDate,
  sourceDetailFrom,
  summariseLedger,
} from "../helpers/account-transactions.js";

const API = "https://api.xero.com/api.xro/2.0";
const JOURNALS_PAGE_SIZE = 100;
const MAX_JOURNAL_PAGES = 1000; // 100k journals
const DEFAULT_LOOKBACK_DAYS = 90;

export type AccountTransactionsParams = {
  accountCodes: string[];
  fromDate: string;
  toDate: string;
  sourceTypes?: string[];
  includeSourceDetails: boolean;
  /** YYYY-MM-DD, or "all" to scan every journal in the organisation. */
  createdSince?: string;
};

export type AccountTransactionsResult = {
  lines: LedgerLine[];
  summary: LedgerSummary;
  currency: string;
  accounts: Array<{ code: string; name: string; id: string }>;
  unknownAccounts: string[];
  scan: {
    createdSince: string | null;
    journalsScanned: number;
    pages: number;
  };
  warnings: string[];
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  await xeroClient.authenticate();
  const accessToken = xeroClient.readTokenSet().access_token;
  if (!accessToken) throw new Error("Xero access token is unavailable.");
  if (!xeroClient.tenantId) throw new Error("Xero tenant ID is unavailable.");
  return {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroClient.tenantId,
    Accept: "application/json",
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with a small retry on Xero's per-minute rate limit (HTTP 429). */
async function xeroGet<T>(
  path: string,
  params: Record<string, string | number | boolean>,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const headers = { ...(await getAuthHeaders()), ...extraHeaders };
      const response = await axios.get<T>(`${API}/${path}`, { headers, params });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 429 && attempt < 4) {
        const retryAfter = Number(axiosError.response.headers?.["retry-after"]);
        const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) : 5 * (attempt + 1);
        await sleep(waitSeconds * 1000);
        continue;
      }
      throw error;
    }
  }
}

type AccountRecord = { AccountID?: string; Code?: string; Name?: string };

async function fetchAccounts(): Promise<AccountRecord[]> {
  const data = await xeroGet<{ Accounts?: AccountRecord[] }>("Accounts", {});
  return data.Accounts ?? [];
}

async function fetchBaseCurrency(): Promise<string> {
  const data = await xeroGet<{ Organisations?: Array<{ BaseCurrency?: string }> }>("Organisation", {});
  return data.Organisations?.[0]?.BaseCurrency ?? "";
}

/**
 * Pages through /Journals (100 per call, ordered by JournalNumber) starting
 * after `offset`. If-Modified-Since limits the scan to journals created since
 * that date; Xero journals are never edited, so this is their creation date.
 */
async function fetchJournals(createdSince: string | null): Promise<{ journals: XeroJournal[]; pages: number }> {
  const journals: XeroJournal[] = [];
  const headers: Record<string, string> = createdSince
    ? { "If-Modified-Since": new Date(`${createdSince}T00:00:00Z`).toUTCString() }
    : {};
  let offset = 0;
  let pages = 0;
  while (pages < MAX_JOURNAL_PAGES) {
    let page: XeroJournal[];
    try {
      const data = await xeroGet<{ Journals?: XeroJournal[] }>("Journals", { offset }, headers);
      page = data.Journals ?? [];
    } catch (error) {
      // Xero answers 304 Not Modified when nothing was created since the date.
      if ((error as AxiosError).response?.status === 304) break;
      throw error;
    }
    pages += 1;
    if (page.length === 0) break;
    journals.push(...page);
    const lastNumber = Math.max(...page.map((j) => j.JournalNumber ?? 0));
    if (page.length < JOURNALS_PAGE_SIZE || lastNumber <= offset) break;
    offset = lastNumber;
  }
  if (pages >= MAX_JOURNAL_PAGES) {
    throw new Error(
      `Stopped after ${MAX_JOURNAL_PAGES} pages of journals. Narrow the scan with createdSince.`,
    );
  }
  return { journals, pages };
}

async function fetchSourceDetails(
  groups: Map<SourceResource, string[]>,
  warnings: string[],
): Promise<Map<string, SourceDetail>> {
  const details = new Map<string, SourceDetail>();
  for (const [resource, ids] of groups) {
    // Invoices take a comma-separated IDs filter; the others take a where clause.
    const batchSize = resource === "Invoices" ? 50 : 25;
    for (const batch of chunk(ids.filter(isGuid), batchSize)) {
      try {
        const params: Record<string, string | number | boolean> =
          resource === "Invoices"
            ? { IDs: batch.join(","), summaryOnly: true }
            : { where: buildIdWhere(resource, batch) };
        const data = await xeroGet<Record<string, unknown>>(resource, params);
        const docs = data[resource];
        for (const doc of Array.isArray(docs) ? docs : []) {
          const parsed = sourceDetailFrom(resource, doc);
          if (parsed) details.set(parsed.id.toLowerCase(), parsed.detail);
        }
      } catch (error) {
        warnings.push(`Could not look up ${batch.length} ${resource} source document(s): ${formatError(error)}`);
      }
    }
  }
  return details;
}

export async function listXeroAccountTransactions(
  params: AccountTransactionsParams,
): Promise<XeroClientResponse<AccountTransactionsResult>> {
  try {
    const warnings: string[] = [];
    const [allAccounts, currency] = await Promise.all([fetchAccounts(), fetchBaseCurrency()]);

    // Resolve requested codes / IDs against the chart of accounts.
    const requested = params.accountCodes.map((v) => v.trim()).filter(Boolean);
    const unknownAccounts: string[] = [];
    const resolved: Array<{ code: string; name: string; id: string }> = [];
    for (const value of requested) {
      const match = allAccounts.find((a) =>
        isGuid(value)
          ? a.AccountID?.toLowerCase() === value.toLowerCase()
          : a.Code?.toUpperCase() === value.toUpperCase(),
      );
      if (match) resolved.push({ code: match.Code ?? "", name: match.Name ?? "", id: match.AccountID ?? "" });
      else unknownAccounts.push(value);
    }
    // Match on IDs as well as codes, so code-less accounts (e.g. some bank accounts) work.
    const matcher = buildAccountMatcher([...requested, ...resolved.map((a) => a.id)]);

    const filter: JournalFilter = {
      fromDate: params.fromDate,
      toDate: params.toDate,
      matcher,
      sourceTypes: normaliseSourceTypes(params.sourceTypes),
    };

    const createdSince =
      params.createdSince === "all"
        ? null
        : params.createdSince ?? shiftIsoDate(params.fromDate, -DEFAULT_LOOKBACK_DAYS);

    const { journals, pages } = await fetchJournals(createdSince);

    const sourceDetails = params.includeSourceDetails
      ? await fetchSourceDetails(groupSourceIds(journals, filter), warnings)
      : new Map<string, SourceDetail>();

    const lines = extractLedgerLines(journals, filter, currency, sourceDetails);

    return {
      result: {
        lines,
        summary: summariseLedger(lines),
        currency,
        accounts: resolved,
        unknownAccounts,
        scan: { createdSince, journalsScanned: journals.length, pages },
        warnings,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

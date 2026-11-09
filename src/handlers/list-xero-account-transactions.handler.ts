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
import {
  AccountLookup,
  DocumentKind,
  buildDocumentWhere,
  documentToLedgerLines,
  sortLedgerLines,
} from "../helpers/account-lines-from-documents.js";

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
  /**
   * "journals" reads /Journals (complete ledger, needs Journals API access);
   * "documents" rebuilds lines from invoices, bills, credit notes, spend/receive
   * money and manual journals; "auto" (default) tries journals and falls back
   * to documents when Xero refuses the Journals endpoint.
   */
  method?: "auto" | "journals" | "documents";
};

export type AccountTransactionsResult = {
  lines: LedgerLine[];
  summary: LedgerSummary;
  currency: string;
  accounts: Array<{ code: string; name: string; id: string }>;
  unknownAccounts: string[];
  scan: {
    method: "journals" | "documents";
    createdSince: string | null;
    journalsScanned: number;
    documentsScanned: number;
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

const DOCUMENT_KINDS: DocumentKind[] = ["Invoices", "CreditNotes", "BankTransactions", "ManualJournals"];
const MAX_DOCUMENT_PAGES = 200; // 100 per page

/** Pages through one document type dated in the period, with line items. */
async function fetchDocuments(
  kind: DocumentKind,
  fromDate: string,
  toDate: string,
): Promise<{ docs: unknown[]; pages: number }> {
  const docs: unknown[] = [];
  const where = buildDocumentWhere(kind, fromDate, toDate);
  let pages = 0;
  for (let page = 1; page <= MAX_DOCUMENT_PAGES; page++) {
    const data = await xeroGet<Record<string, unknown>>(kind, { where, page });
    const batch = Array.isArray(data[kind]) ? (data[kind] as unknown[]) : [];
    pages += 1;
    docs.push(...batch);
    if (batch.length < 100) return { docs, pages };
  }
  throw new Error(`Stopped after ${MAX_DOCUMENT_PAGES} pages of ${kind}. Narrow the date range.`);
}

function isAccessDenied(error: unknown): boolean {
  const status = (error as AxiosError)?.response?.status;
  return status === 401 || status === 403;
}

async function ledgerFromDocuments(
  filter: JournalFilter,
  currency: string,
  allAccounts: AccountRecord[],
  warnings: string[],
): Promise<{ lines: LedgerLine[]; documentsScanned: number; pages: number }> {
  const lookup: AccountLookup = new Map();
  for (const a of allAccounts) {
    const entry = { code: a.Code ?? "", name: a.Name ?? "", id: a.AccountID ?? "" };
    if (a.AccountID) lookup.set(a.AccountID.toLowerCase(), entry);
    if (a.Code) lookup.set(a.Code.toUpperCase(), entry);
  }
  const lines: LedgerLine[] = [];
  let documentsScanned = 0;
  let pages = 0;
  for (const kind of DOCUMENT_KINDS) {
    try {
      const result = await fetchDocuments(kind, filter.fromDate, filter.toDate);
      documentsScanned += result.docs.length;
      pages += result.pages;
      for (const doc of result.docs) {
        lines.push(...documentToLedgerLines(kind, doc, filter, currency, lookup));
      }
    } catch (error) {
      warnings.push(`Could not read ${kind}: ${formatError(error)}. Lines from ${kind} are missing.`);
    }
  }
  warnings.push(
    "Rebuilt from source documents (invoices, bills, credit notes, spend/receive money, manual journals) because the Journals endpoint is not available. " +
      "Entries Xero generates itself (payment FX gains, revaluations, conversion balances, tax-rate postings) are not included, and foreign-currency lines are converted per line, so check the total against the trial balance movement.",
  );
  return { lines: sortLedgerLines(lines), documentsScanned, pages };
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

    const method = params.method ?? "auto";
    if (method === "documents") {
      const docs = await ledgerFromDocuments(filter, currency, allAccounts, warnings);
      return {
        result: {
          lines: docs.lines,
          summary: summariseLedger(docs.lines),
          currency,
          accounts: resolved,
          unknownAccounts,
          scan: { method: "documents", createdSince: null, journalsScanned: 0, documentsScanned: docs.documentsScanned, pages: docs.pages },
          warnings,
        },
        isError: false,
        error: null,
      };
    }

    const createdSince =
      params.createdSince === "all"
        ? null
        : params.createdSince ?? shiftIsoDate(params.fromDate, -DEFAULT_LOOKBACK_DAYS);

    let journalsResult: { journals: XeroJournal[]; pages: number };
    try {
      journalsResult = await fetchJournals(createdSince);
    } catch (error) {
      if (method === "auto" && isAccessDenied(error)) {
        warnings.push(`Journals endpoint refused (${formatError(error)}).`);
        const docs = await ledgerFromDocuments(filter, currency, allAccounts, warnings);
        return {
          result: {
            lines: docs.lines,
            summary: summariseLedger(docs.lines),
            currency,
            accounts: resolved,
            unknownAccounts,
            scan: { method: "documents", createdSince: null, journalsScanned: 0, documentsScanned: docs.documentsScanned, pages: docs.pages },
            warnings,
          },
          isError: false,
          error: null,
        };
      }
      throw error;
    }
    const { journals, pages } = journalsResult;

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
        scan: { method: "journals", createdSince, journalsScanned: journals.length, documentsScanned: 0, pages },
        warnings,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

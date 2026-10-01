/**
 * Pure helpers for the list-account-transactions tool (general ledger built
 * from Xero's /Journals endpoint). No I/O here so the logic is unit-testable.
 */

export type XeroJournalLine = {
  JournalLineID?: string;
  AccountID?: string;
  AccountCode?: string;
  AccountType?: string;
  AccountName?: string;
  Description?: string;
  NetAmount?: number;
  GrossAmount?: number;
  TaxAmount?: number;
  TaxType?: string;
  TaxName?: string;
  TrackingCategories?: Array<{ Name?: string; Option?: string }>;
};

export type XeroJournal = {
  JournalID?: string;
  JournalDate?: string;
  JournalNumber?: number;
  CreatedDateUTC?: string;
  Reference?: string;
  SourceID?: string;
  SourceType?: string;
  JournalLines?: XeroJournalLine[];
};

export type SourceDetail = {
  number?: string;
  reference?: string;
  contact?: string;
};

export type LedgerLine = {
  date: string;
  sourceType: string;
  number: string;
  reference: string;
  contact: string;
  description: string;
  accountCode: string;
  accountName: string;
  accountId: string;
  taxType: string;
  net: number;
  tax: number;
  gross: number;
  currency: string;
  tracking: string;
  journalNumber: number;
  sourceId: string;
};

export type AccountSummary = {
  accountCode: string;
  accountName: string;
  lines: number;
  debit: number;
  credit: number;
  net: number;
};

export type LedgerSummary = {
  accounts: AccountSummary[];
  totalDebit: number;
  totalCredit: number;
  net: number;
};

/** Journal source types Xero uses, plus friendly aliases people type. */
const SOURCE_TYPE_ALIASES: Record<string, string> = {
  SPEND: "CASHPAID",
  "SPEND-MONEY": "CASHPAID",
  SPENDMONEY: "CASHPAID",
  RECEIVE: "CASHREC",
  "RECEIVE-MONEY": "CASHREC",
  RECEIVEMONEY: "CASHREC",
  BILL: "ACCPAY",
  INVOICE: "ACCREC",
  MANUALJOURNAL: "MANJOURNAL",
};

export function normaliseSourceTypes(values: string[] | undefined): Set<string> | null {
  if (!values || values.length === 0) return null;
  const set = new Set<string>();
  for (const raw of values) {
    const upper = raw.trim().toUpperCase();
    if (!upper) continue;
    set.add(SOURCE_TYPE_ALIASES[upper] ?? upper);
  }
  return set.size > 0 ? set : null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string): boolean {
  return GUID.test(value.trim());
}

/** Converts "/Date(1756684800000+0000)/" or an ISO string to YYYY-MM-DD (UTC). */
export function toIsoDate(value: string | undefined | null): string {
  if (!value) return "";
  const msMatch = value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (msMatch) {
    return new Date(Number(msMatch[1])).toISOString().slice(0, 10);
  }
  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Amounts are summed in integer cents to avoid floating point drift. */
const toCents = (value: number | undefined) => Math.round((value ?? 0) * 100);
const fromCents = (cents: number) => cents / 100;

export type AccountMatcher = {
  codes: Set<string>;
  ids: Set<string>;
};

export function buildAccountMatcher(accountCodes: string[]): AccountMatcher {
  const codes = new Set<string>();
  const ids = new Set<string>();
  for (const raw of accountCodes) {
    const value = raw.trim();
    if (!value) continue;
    if (isGuid(value)) ids.add(value.toLowerCase());
    else codes.add(value.toUpperCase());
  }
  return { codes, ids };
}

export function lineMatchesAccount(line: XeroJournalLine, matcher: AccountMatcher): boolean {
  if (line.AccountID && matcher.ids.has(line.AccountID.toLowerCase())) return true;
  if (line.AccountCode && matcher.codes.has(line.AccountCode.toUpperCase())) return true;
  return false;
}

export function formatTracking(line: XeroJournalLine): string {
  return (line.TrackingCategories ?? [])
    .filter((t) => t.Name || t.Option)
    .map((t) => `${t.Name ?? ""}: ${t.Option ?? ""}`)
    .join("; ");
}

export type JournalFilter = {
  fromDate: string;
  toDate: string;
  matcher: AccountMatcher;
  sourceTypes: Set<string> | null;
};

/** True when a journal is dated inside the period and has the right source type. */
export function journalInScope(journal: XeroJournal, filter: JournalFilter): boolean {
  const date = toIsoDate(journal.JournalDate);
  if (!date || date < filter.fromDate || date > filter.toDate) return false;
  if (filter.sourceTypes && !filter.sourceTypes.has((journal.SourceType ?? "").toUpperCase())) {
    return false;
  }
  return true;
}

export function extractLedgerLines(
  journals: XeroJournal[],
  filter: JournalFilter,
  currency: string,
  sourceDetails: Map<string, SourceDetail> = new Map(),
): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const journal of journals) {
    if (!journalInScope(journal, filter)) continue;
    const date = toIsoDate(journal.JournalDate);
    const sourceId = journal.SourceID ?? "";
    const detail = sourceDetails.get(sourceId.toLowerCase()) ?? {};
    for (const line of journal.JournalLines ?? []) {
      if (!lineMatchesAccount(line, filter.matcher)) continue;
      lines.push({
        date,
        sourceType: journal.SourceType ?? "",
        number: detail.number ?? "",
        reference: detail.reference ?? journal.Reference ?? "",
        contact: detail.contact ?? "",
        description: line.Description ?? "",
        accountCode: line.AccountCode ?? "",
        accountName: line.AccountName ?? "",
        accountId: line.AccountID ?? "",
        taxType: line.TaxType ?? "",
        net: line.NetAmount ?? 0,
        tax: line.TaxAmount ?? 0,
        gross: line.GrossAmount ?? (line.NetAmount ?? 0) + (line.TaxAmount ?? 0),
        currency,
        tracking: formatTracking(line),
        journalNumber: journal.JournalNumber ?? 0,
        sourceId,
      });
    }
  }
  lines.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.journalNumber - b.journalNumber ||
      a.accountCode.localeCompare(b.accountCode),
  );
  return lines;
}

/** Positive net = debit, negative net = credit (Xero journal convention). */
export function summariseLedger(lines: LedgerLine[]): LedgerSummary {
  const byAccount = new Map<string, { code: string; name: string; lines: number; debit: number; credit: number }>();
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const key = line.accountId || line.accountCode;
    const entry =
      byAccount.get(key) ?? { code: line.accountCode, name: line.accountName, lines: 0, debit: 0, credit: 0 };
    const cents = toCents(line.net);
    if (cents >= 0) {
      entry.debit += cents;
      totalDebit += cents;
    } else {
      entry.credit -= cents;
      totalCredit -= cents;
    }
    entry.lines += 1;
    byAccount.set(key, entry);
  }
  const accounts = [...byAccount.values()]
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name))
    .map((a) => ({
      accountCode: a.code,
      accountName: a.name,
      lines: a.lines,
      debit: fromCents(a.debit),
      credit: fromCents(a.credit),
      net: fromCents(a.debit - a.credit),
    }));
  return {
    accounts,
    totalDebit: fromCents(totalDebit),
    totalCredit: fromCents(totalCredit),
    net: fromCents(totalDebit - totalCredit),
  };
}

const money = (value: number) => value.toFixed(2);
const cell = (value: string | number) => String(value).replace(/[|\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();

export const LEDGER_COLUMNS = [
  "Date",
  "Source",
  "Number",
  "Reference",
  "Contact",
  "Description",
  "Account",
  "Account name",
  "Tax type",
  "Net",
  "Tax",
  "Gross",
  "Ccy",
  "Tracking",
  "Journal #",
  "Source ID",
] as const;

export function ledgerLineToRow(line: LedgerLine): string[] {
  return [
    line.date,
    line.sourceType,
    line.number,
    line.reference,
    line.contact,
    line.description,
    line.accountCode,
    line.accountName,
    line.taxType,
    money(line.net),
    money(line.tax),
    money(line.gross),
    line.currency,
    line.tracking,
    String(line.journalNumber),
    line.sourceId,
  ].map(cell);
}

export function formatSummaryTable(summary: LedgerSummary): string {
  const out = ["Account | Account name | Lines | Debits | Credits | Net movement (Dr+ / Cr-)"];
  for (const a of summary.accounts) {
    out.push(
      [a.accountCode, a.accountName, a.lines, money(a.debit), money(a.credit), money(a.net)].map(cell).join(" | "),
    );
  }
  out.push(
    ["TOTAL", "", summary.accounts.reduce((n, a) => n + a.lines, 0), money(summary.totalDebit), money(summary.totalCredit), money(summary.net)]
      .map(cell)
      .join(" | "),
  );
  return out.join("\n");
}

export function formatLedgerTable(lines: LedgerLine[], maxRows: number): { text: string; truncated: number } {
  const shown = lines.slice(0, maxRows);
  const out = [LEDGER_COLUMNS.join(" | ")];
  for (const line of shown) out.push(ledgerLineToRow(line).join(" | "));
  return { text: out.join("\n"), truncated: Math.max(0, lines.length - shown.length) };
}

/** Which Xero endpoint resolves a journal's SourceID, by journal source type. */
export type SourceResource =
  | "Invoices"
  | "CreditNotes"
  | "BankTransactions"
  | "Payments"
  | "ManualJournals"
  | "Prepayments"
  | "Overpayments"
  | "BankTransfers";

export function sourceResourceFor(sourceType: string | undefined): SourceResource | null {
  switch ((sourceType ?? "").toUpperCase()) {
    case "ACCREC":
    case "ACCPAY":
      return "Invoices";
    case "ACCRECCREDIT":
    case "ACCPAYCREDIT":
      return "CreditNotes";
    case "CASHREC":
    case "CASHPAID":
      return "BankTransactions";
    case "ACCRECPAYMENT":
    case "ACCPAYPAYMENT":
    case "ARCREDITPAYMENT":
    case "APCREDITPAYMENT":
    case "ARPREPAYMENTPAYMENT":
    case "APPREPAYMENTPAYMENT":
    case "AROVERPAYMENTPAYMENT":
    case "APOVERPAYMENTPAYMENT":
      return "Payments";
    case "MANJOURNAL":
      return "ManualJournals";
    case "ARPREPAYMENT":
    case "APPREPAYMENT":
      return "Prepayments";
    case "AROVERPAYMENT":
    case "APOVERPAYMENT":
      return "Overpayments";
    case "TRANSFER":
      return "BankTransfers";
    default:
      return null;
  }
}

/** Groups the in-scope journals' source IDs by the endpoint that resolves them. */
export function groupSourceIds(journals: XeroJournal[], filter: JournalFilter): Map<SourceResource, string[]> {
  const groups = new Map<SourceResource, Set<string>>();
  for (const journal of journals) {
    if (!journal.SourceID || !journalInScope(journal, filter)) continue;
    if (!(journal.JournalLines ?? []).some((l) => lineMatchesAccount(l, filter.matcher))) continue;
    const resource = sourceResourceFor(journal.SourceType);
    if (!resource) continue;
    const set = groups.get(resource) ?? new Set<string>();
    set.add(journal.SourceID);
    groups.set(resource, set);
  }
  return new Map([...groups].map(([k, v]) => [k, [...v]]));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const RESOURCE_ID_FIELD: Record<SourceResource, string> = {
  Invoices: "InvoiceID",
  CreditNotes: "CreditNoteID",
  BankTransactions: "BankTransactionID",
  Payments: "PaymentID",
  ManualJournals: "ManualJournalID",
  Prepayments: "PrepaymentID",
  Overpayments: "OverpaymentID",
  BankTransfers: "BankTransferID",
};

export function resourceIdField(resource: SourceResource): string {
  return RESOURCE_ID_FIELD[resource];
}

/** Xero where clause matching any of the given IDs. */
export function buildIdWhere(resource: SourceResource, ids: string[]): string {
  const field = RESOURCE_ID_FIELD[resource];
  return ids.filter(isGuid).map((id) => `${field}==Guid("${id}")`).join(" OR ");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pulls number / reference / contact out of a source document returned by Xero. */
export function sourceDetailFrom(resource: SourceResource, doc: any): { id: string; detail: SourceDetail } | null {
  const id: string | undefined = doc?.[RESOURCE_ID_FIELD[resource]];
  if (!id) return null;
  const contact: string | undefined = doc?.Contact?.Name;
  switch (resource) {
    case "Invoices":
      return { id, detail: { number: doc.InvoiceNumber, reference: doc.Reference, contact } };
    case "CreditNotes":
      return { id, detail: { number: doc.CreditNoteNumber, reference: doc.Reference, contact } };
    case "BankTransactions":
      return { id, detail: { reference: doc.Reference, contact } };
    case "Payments":
      return {
        id,
        detail: {
          number:
            doc?.Invoice?.InvoiceNumber ??
            doc?.CreditNote?.CreditNoteNumber ??
            undefined,
          reference: doc.Reference,
          contact: doc?.Invoice?.Contact?.Name ?? doc?.CreditNote?.Contact?.Name ?? contact,
        },
      };
    case "ManualJournals":
      return { id, detail: { reference: doc.Narration } };
    case "Prepayments":
    case "Overpayments":
      return { id, detail: { reference: doc.Reference, contact } };
    case "BankTransfers":
      return {
        id,
        detail: {
          reference:
            doc.Reference ??
            [doc?.FromBankAccount?.Name, doc?.ToBankAccount?.Name].filter(Boolean).join(" -> "),
        },
      };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Compact trial balance                                              */
/* ------------------------------------------------------------------ */

type ReportCell = { value?: string | null; attributes?: Array<{ id?: string; value?: string }> | null };
type ReportRow = { rowType?: string; title?: string | null; cells?: ReportCell[] | null; rows?: ReportRow[] | null };

/** "Sales (200)" -> { name: "Sales", code: "200" }. */
export function splitAccountLabel(label: string): { code: string; name: string } {
  const match = label.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (match) return { name: match[1].trim(), code: match[2].trim() };
  return { name: label.trim(), code: "" };
}

const amountCell = (value: string | null | undefined) => {
  const v = (value ?? "").trim();
  return v === "" ? "0.00" : v;
};

/**
 * One line per account: code | name | debit | credit | YTD debit | YTD credit,
 * grouped under section headings, with Xero's section/report totals.
 */
export function compactTrialBalance(rows: ReportRow[] | null | undefined, opts: { hideZero?: boolean } = {}): string {
  const out: string[] = ["Code | Account | Debit | Credit | YTD Debit | YTD Credit"];
  let accountCount = 0;
  const isZero = (cells: string[]) => cells.every((v) => Number(v.replace(/,/g, "")) === 0);
  for (const row of rows ?? []) {
    const type = String(row.rowType ?? "");
    if (type === "Header") continue;
    if (type === "Section") {
      const children = row.rows ?? [];
      const accountRows = children.filter((r) => String(r.rowType) === "Row");
      const summary = children.find((r) => String(r.rowType) === "SummaryRow");
      if (row.title) out.push(`## ${row.title}`);
      for (const r of accountRows) {
        const cells = r.cells ?? [];
        const { code, name } = splitAccountLabel(cells[0]?.value ?? "");
        const amounts = [1, 2, 3, 4].map((i) => amountCell(cells[i]?.value));
        if (opts.hideZero && isZero(amounts)) continue;
        out.push([code, name, ...amounts].map(cell).join(" | "));
        accountCount += 1;
      }
      if (summary) {
        const cells = summary.cells ?? [];
        out.push(
          [cells[0]?.value || "Total", "", ...[1, 2, 3, 4].map((i) => amountCell(cells[i]?.value))].map(cell).join(" | "),
        );
      }
      continue;
    }
    if (type === "SummaryRow" || type === "Row") {
      const cells = row.cells ?? [];
      out.push([cells[0]?.value || "Total", "", ...[1, 2, 3, 4].map((i) => amountCell(cells[i]?.value))].map(cell).join(" | "));
    }
  }
  out.splice(1, 0, `(${accountCount} accounts)`);
  return out.join("\n");
}

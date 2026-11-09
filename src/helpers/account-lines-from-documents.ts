/**
 * Pure helpers that rebuild account ledger lines from Xero source documents
 * (invoices, bills, credit notes, spend/receive money, manual journals) when
 * the /Journals endpoint is not available to the connected app. No I/O here.
 *
 * This covers lines that are coded directly to an account on a document. It
 * does not see entries Xero generates itself (payments' FX gains, bank
 * revaluations, conversion balances, tax rate postings to the VAT control
 * account), so totals should be checked against the trial balance movement.
 */

import {
  AccountMatcher,
  LedgerLine,
  isGuid,
  toIsoDate,
} from "./account-transactions.js";

export type DocumentLine = {
  AccountCode?: string;
  AccountID?: string;
  Description?: string;
  LineAmount?: number;
  TaxAmount?: number;
  TaxType?: string;
  Tracking?: Array<{ Name?: string; Option?: string }>;
};

export type DocumentKind = "Invoices" | "CreditNotes" | "BankTransactions" | "ManualJournals";

/** Ledger sign of a document's lines: +1 debits the line account, -1 credits it. */
export function documentSign(kind: DocumentKind, type: string | undefined): 1 | -1 {
  const t = (type ?? "").toUpperCase();
  if (kind === "ManualJournals") return 1; // LineAmount is already signed (debit positive)
  if (kind === "Invoices") return t === "ACCREC" ? -1 : 1;
  if (kind === "CreditNotes") return t === "ACCRECCREDIT" ? 1 : -1;
  // BankTransactions: SPEND* debit the line account, RECEIVE* credit it.
  return t.startsWith("RECEIVE") ? -1 : 1;
}

/** Journal source type label matching what the Journals-based report shows. */
export function documentSourceType(kind: DocumentKind, type: string | undefined): string {
  const t = (type ?? "").toUpperCase();
  if (kind === "ManualJournals") return "MANJOURNAL";
  if (kind === "BankTransactions") {
    if (t === "SPEND") return "CASHPAID";
    if (t === "RECEIVE") return "CASHREC";
    return t; // e.g. SPEND-OVERPAYMENT, RECEIVE-PREPAYMENT
  }
  return t; // ACCREC, ACCPAY, ACCRECCREDIT, ACCPAYCREDIT
}

const POSTED_STATUSES: Record<DocumentKind, string[]> = {
  Invoices: ["AUTHORISED", "PAID"],
  CreditNotes: ["AUTHORISED", "PAID"],
  BankTransactions: ["AUTHORISED"],
  ManualJournals: ["POSTED"],
};

export function isPosted(kind: DocumentKind, status: string | undefined): boolean {
  return POSTED_STATUSES[kind].includes((status ?? "").toUpperCase());
}

/** Xero where clause for documents dated in [from, to] with a posted status. */
export function buildDocumentWhere(kind: DocumentKind, fromDate: string, toDate: string): string {
  const dt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `DateTime(${y},${m},${d})`;
  };
  const statuses = POSTED_STATUSES[kind].map((s) => `Status=="${s}"`).join(" OR ");
  return `Date>=${dt(fromDate)} AND Date<=${dt(toDate)} AND (${statuses})`;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function lineMatches(line: DocumentLine, matcher: AccountMatcher): boolean {
  if (line.AccountID && matcher.ids.has(line.AccountID.toLowerCase())) return true;
  if (line.AccountCode && matcher.codes.has(line.AccountCode.toUpperCase())) return true;
  return false;
}

function tracking(line: DocumentLine): string {
  return (line.Tracking ?? [])
    .filter((t) => t.Name || t.Option)
    .map((t) => `${t.Name ?? ""}: ${t.Option ?? ""}`)
    .join("; ");
}

export type DocumentFilter = {
  fromDate: string;
  toDate: string;
  matcher: AccountMatcher;
  sourceTypes: Set<string> | null;
};

export type AccountLookup = Map<string, { code: string; name: string; id: string }>;

/**
 * Turns one source document into ledger lines for the matching accounts.
 * Amounts are converted to base currency with the document's CurrencyRate
 * (foreign units per one unit of base currency) and rounded per line.
 */
export function documentToLedgerLines(
  kind: DocumentKind,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  filter: DocumentFilter,
  baseCurrency: string,
  accounts: AccountLookup,
): LedgerLine[] {
  if (!doc || !isPosted(kind, doc.Status)) return [];
  const date = toIsoDate(doc.Date ?? doc.DateString);
  if (!date || date < filter.fromDate || date > filter.toDate) return [];
  const sourceType = documentSourceType(kind, doc.Type);
  if (filter.sourceTypes && !filter.sourceTypes.has(sourceType)) return [];

  const sign = documentSign(kind, doc.Type);
  const rawRate = Number(doc.CurrencyRate);
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;
  const amountTypes = String(doc.LineAmountTypes ?? "").toUpperCase();
  const inclusive = amountTypes === "INCLUSIVE";
  const rawLines: DocumentLine[] = kind === "ManualJournals" ? doc.JournalLines ?? [] : doc.LineItems ?? [];

  const id =
    doc.InvoiceID ?? doc.CreditNoteID ?? doc.BankTransactionID ?? doc.ManualJournalID ?? "";
  const number =
    kind === "Invoices"
      ? doc.InvoiceNumber ?? ""
      : kind === "CreditNotes"
        ? doc.CreditNoteNumber ?? ""
        : "";
  const reference = kind === "ManualJournals" ? doc.Narration ?? "" : doc.Reference ?? "";
  const contact = doc.Contact?.Name ?? "";

  const out: LedgerLine[] = [];
  for (const line of rawLines) {
    if (!lineMatches(line, filter.matcher)) continue;
    const lineAmount = Number(line.LineAmount ?? 0);
    const taxAmount = Number(line.TaxAmount ?? 0);
    const netDoc = inclusive ? lineAmount - taxAmount : lineAmount;
    const net = round2((sign * netDoc) / rate);
    const tax = round2((sign * taxAmount) / rate);
    const account =
      (line.AccountID && accounts.get(line.AccountID.toLowerCase())) ||
      (line.AccountCode && accounts.get(line.AccountCode.toUpperCase())) ||
      undefined;
    out.push({
      date,
      sourceType,
      number,
      reference,
      contact,
      description: line.Description ?? "",
      accountCode: line.AccountCode ?? account?.code ?? "",
      accountName: account?.name ?? "",
      accountId: line.AccountID ?? account?.id ?? "",
      taxType: line.TaxType ?? "",
      net,
      tax,
      gross: round2(net + tax),
      currency: baseCurrency,
      tracking: tracking(line),
      journalNumber: 0,
      sourceId: isGuid(String(id)) ? String(id) : "",
    });
  }
  return out;
}

export function sortLedgerLines(lines: LedgerLine[]): LedgerLine[] {
  return lines.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sourceType.localeCompare(b.sourceType) ||
      a.number.localeCompare(b.number) ||
      a.reference.localeCompare(b.reference) ||
      a.accountCode.localeCompare(b.accountCode),
  );
}

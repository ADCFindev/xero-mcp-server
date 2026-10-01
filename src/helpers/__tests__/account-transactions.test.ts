import { describe, it, expect } from "vitest";
import {
  XeroJournal,
  buildAccountMatcher,
  buildIdWhere,
  compactTrialBalance,
  extractLedgerLines,
  formatLedgerTable,
  formatSummaryTable,
  groupSourceIds,
  normaliseSourceTypes,
  shiftIsoDate,
  sourceDetailFrom,
  splitAccountLabel,
  summariseLedger,
  toIsoDate,
} from "../account-transactions.js";

const ms = (iso: string) => `/Date(${Date.parse(`${iso}T00:00:00Z`)}+0000)/`;

const VAT_ID = "11111111-1111-1111-1111-111111111111";
const INV_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const journals: XeroJournal[] = [
  {
    JournalNumber: 10,
    JournalDate: ms("2026-08-31"),
    SourceType: "ACCPAY",
    SourceID: INV_ID,
    JournalLines: [{ AccountID: VAT_ID, AccountCode: "822", AccountName: "VAT - DE", NetAmount: 5 }],
  },
  {
    JournalNumber: 11,
    JournalDate: ms("2026-09-02"),
    SourceType: "ACCPAY",
    SourceID: INV_ID,
    Reference: "journal-ref",
    JournalLines: [
      { AccountCode: "400", AccountName: "Advertising", NetAmount: 100, TaxAmount: 19, GrossAmount: 119, TaxType: "INPUT" },
      { AccountID: VAT_ID, AccountCode: "822", AccountName: "VAT - DE", NetAmount: 19.1, TaxAmount: 0, GrossAmount: 19.1 },
      { AccountCode: "800", AccountName: "Accounts Payable", NetAmount: -119.1 },
    ],
  },
  {
    JournalNumber: 12,
    JournalDate: ms("2026-09-30"),
    SourceType: "CASHREC",
    SourceID: BT_ID,
    JournalLines: [
      {
        AccountID: VAT_ID,
        AccountCode: "822",
        AccountName: "VAT - DE",
        NetAmount: -0.2,
        TrackingCategories: [{ Name: "Region", Option: "DE" }],
      },
    ],
  },
  {
    JournalNumber: 13,
    JournalDate: ms("2026-10-01"),
    SourceType: "MANJOURNAL",
    JournalLines: [{ AccountCode: "822", NetAmount: 50 }],
  },
];

const filter = {
  fromDate: "2026-09-01",
  toDate: "2026-09-30",
  matcher: buildAccountMatcher(["822"]),
  sourceTypes: null,
};

describe("account-transactions helpers", () => {
  it("parses Xero dates", () => {
    expect(toIsoDate(ms("2026-09-02"))).toBe("2026-09-02");
    expect(toIsoDate("2026-09-02T00:00:00")).toBe("2026-09-02");
    expect(shiftIsoDate("2026-09-01", -90)).toBe("2026-06-03");
  });

  it("maps source type aliases", () => {
    expect([...(normaliseSourceTypes(["spend", "RECEIVE", "accpay"]) ?? [])]).toEqual(["CASHPAID", "CASHREC", "ACCPAY"]);
    expect(normaliseSourceTypes([])).toBeNull();
  });

  it("keeps only in-period lines for the requested accounts, sorted by date", () => {
    const lines = extractLedgerLines(journals, filter, "EUR");
    expect(lines.map((l) => l.journalNumber)).toEqual([11, 12]);
    expect(lines[0].reference).toBe("journal-ref");
    expect(lines[1].tracking).toBe("Region: DE");
    expect(lines[1].currency).toBe("EUR");
  });

  it("matches by account ID as well as code", () => {
    const byId = extractLedgerLines(journals, { ...filter, matcher: buildAccountMatcher([VAT_ID]) }, "EUR");
    expect(byId.length).toBe(2);
  });

  it("filters on source type", () => {
    const lines = extractLedgerLines(journals, { ...filter, sourceTypes: normaliseSourceTypes(["RECEIVE"]) }, "EUR");
    expect(lines.map((l) => l.sourceType)).toEqual(["CASHREC"]);
  });

  it("summarises debits, credits and net in cents", () => {
    const summary = summariseLedger(extractLedgerLines(journals, filter, "EUR"));
    expect(summary.totalDebit).toBe(19.1);
    expect(summary.totalCredit).toBe(0.2);
    expect(summary.net).toBe(18.9);
    expect(summary.accounts).toEqual([
      { accountCode: "822", accountName: "VAT - DE", lines: 2, debit: 19.1, credit: 0.2, net: 18.9 },
    ]);
    expect(formatSummaryTable(summary)).toContain("TOTAL |  | 2 | 19.10 | 0.20 | 18.90");
  });

  it("applies source details and truncates the table", () => {
    const details = new Map([[INV_ID, { number: "BILL-1", reference: "PO 7", contact: "Acme | GmbH" }]]);
    const lines = extractLedgerLines(journals, filter, "EUR", details);
    expect(lines[0].number).toBe("BILL-1");
    const table = formatLedgerTable(lines, 1);
    expect(table.truncated).toBe(1);
    expect(table.text).toContain("BILL-1 | PO 7 | Acme GmbH");
  });

  it("groups source IDs of in-scope journals by endpoint", () => {
    const groups = groupSourceIds(journals, filter);
    expect(groups.get("Invoices")).toEqual([INV_ID]);
    expect(groups.get("BankTransactions")).toEqual([BT_ID]);
    expect(groups.has("ManualJournals")).toBe(false);
  });

  it("builds where clauses and reads source documents", () => {
    expect(buildIdWhere("Payments", [INV_ID, "not-a-guid"])).toBe(`PaymentID==Guid("${INV_ID}")`);
    expect(
      sourceDetailFrom("Payments", {
        PaymentID: INV_ID,
        Reference: "r",
        Invoice: { InvoiceNumber: "INV-9", Contact: { Name: "Bob" } },
      }),
    ).toEqual({ id: INV_ID, detail: { number: "INV-9", reference: "r", contact: "Bob" } });
  });
});

describe("compactTrialBalance", () => {
  it("prints one line per account with section totals", () => {
    const rows = [
      { rowType: "Header", cells: [{ value: "Account" }, { value: "Debit" }, { value: "Credit" }, { value: "YTD Debit" }, { value: "YTD Credit" }] },
      {
        rowType: "Section",
        title: "Liabilities",
        rows: [
          {
            rowType: "Row",
            cells: [
              { value: "VAT - DE (822)", attributes: [{ id: "account", value: VAT_ID }] },
              { value: "" },
              { value: "18.90" },
              { value: "" },
              { value: "100.00" },
            ],
          },
          { rowType: "Row", cells: [{ value: "Suspense (999)" }, { value: "0.00" }, { value: "0.00" }, { value: "0.00" }, { value: "0.00" }] },
        ],
      },
      { rowType: "Section", title: "", rows: [{ rowType: "SummaryRow", cells: [{ value: "Total" }, { value: "1.00" }, { value: "1.00" }, { value: "2.00" }, { value: "2.00" }] }] },
    ];
    const text = compactTrialBalance(rows);
    expect(text).toContain("## Liabilities\n822 | VAT - DE | 0.00 | 18.90 | 0.00 | 100.00");
    expect(text).toContain("Total |  | 1.00 | 1.00 | 2.00 | 2.00");
    expect(text).not.toContain("attributes");
    expect(compactTrialBalance(rows, { hideZero: true })).not.toContain("Suspense");
    expect(splitAccountLabel("Bank (Main) (090)")).toEqual({ name: "Bank (Main)", code: "090" });
  });
});

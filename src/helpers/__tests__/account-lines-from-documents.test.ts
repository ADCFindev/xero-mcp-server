import { describe, expect, it } from "vitest";

import { buildAccountMatcher, summariseLedger } from "../account-transactions.js";
import {
  AccountLookup,
  buildDocumentWhere,
  documentSign,
  documentToLedgerLines,
} from "../account-lines-from-documents.js";

const filter = {
  fromDate: "2026-10-01",
  toDate: "2026-10-31",
  matcher: buildAccountMatcher(["822"]),
  sourceTypes: null,
};
const accounts: AccountLookup = new Map([["822", { code: "822", name: "VAT - DE", id: "acc-822" }]]);

describe("documentSign", () => {
  it("credits sales invoice lines and debits bill lines", () => {
    expect(documentSign("Invoices", "ACCREC")).toBe(-1);
    expect(documentSign("Invoices", "ACCPAY")).toBe(1);
    expect(documentSign("CreditNotes", "ACCRECCREDIT")).toBe(1);
    expect(documentSign("CreditNotes", "ACCPAYCREDIT")).toBe(-1);
    expect(documentSign("BankTransactions", "SPEND")).toBe(1);
    expect(documentSign("BankTransactions", "RECEIVE-OVERPAYMENT")).toBe(-1);
    expect(documentSign("ManualJournals", undefined)).toBe(1);
  });
});

describe("buildDocumentWhere", () => {
  it("filters on date range and posted statuses", () => {
    expect(buildDocumentWhere("Invoices", "2026-10-01", "2026-10-31")).toBe(
      'Date>=DateTime(2026,10,1) AND Date<=DateTime(2026,10,31) AND (Status=="AUTHORISED" OR Status=="PAID")',
    );
    expect(buildDocumentWhere("ManualJournals", "2026-10-01", "2026-10-31")).toContain('Status=="POSTED"');
  });
});

describe("documentToLedgerLines", () => {
  it("credits a sales invoice tax line coded to the account", () => {
    const doc = {
      InvoiceID: "33f4d76d-a416-4606-9529-280a3c5a4752",
      Type: "ACCREC",
      Status: "PAID",
      Date: "/Date(1791763200000+0000)/", // 2026-10-12
      InvoiceNumber: "INV-1",
      Reference: "A2X-SH",
      Contact: { Name: "Shopify" },
      CurrencyRate: 1,
      LineAmountTypes: "Inclusive",
      LineItems: [
        { AccountCode: "200", LineAmount: 100, TaxAmount: 0 },
        { AccountCode: "822", LineAmount: 15.83, TaxAmount: 0, Description: "Tax - DE" },
      ],
    };
    const lines = documentToLedgerLines("Invoices", doc, filter, "GBP", accounts);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      date: "2026-10-12",
      sourceType: "ACCREC",
      number: "INV-1",
      contact: "Shopify",
      accountName: "VAT - DE",
      net: -15.83,
    });
  });

  it("converts foreign-currency lines to base and debits bills", () => {
    const doc = {
      Type: "ACCPAY",
      Status: "AUTHORISED",
      Date: "2026-10-06T00:00:00",
      CurrencyRate: 1.25,
      LineAmountTypes: "Exclusive",
      LineItems: [{ AccountCode: "822", LineAmount: 31.13, TaxAmount: 0 }],
    };
    const [line] = documentToLedgerLines("Invoices", doc, filter, "GBP", accounts);
    expect(line.net).toBe(24.9);
  });

  it("removes tax from inclusive lines and skips drafts and out-of-period documents", () => {
    const base = {
      Type: "SPEND",
      Date: "2026-10-15T00:00:00",
      LineAmountTypes: "Inclusive",
      LineItems: [{ AccountCode: "822", LineAmount: 120, TaxAmount: 20 }],
    };
    expect(documentToLedgerLines("BankTransactions", { ...base, Status: "AUTHORISED" }, filter, "GBP", accounts)[0].net).toBe(100);
    expect(documentToLedgerLines("BankTransactions", { ...base, Status: "DELETED" }, filter, "GBP", accounts)).toHaveLength(0);
    expect(
      documentToLedgerLines("BankTransactions", { ...base, Status: "AUTHORISED", Date: "2026-11-01T00:00:00" }, filter, "GBP", accounts),
    ).toHaveLength(0);
  });

  it("keeps manual journal signs and summarises debits and credits", () => {
    const doc = {
      Status: "POSTED",
      Date: "2026-10-31T00:00:00",
      Narration: "VAT reclass",
      JournalLines: [
        { AccountCode: "822", LineAmount: -50 },
        { AccountCode: "820", LineAmount: 50 },
      ],
    };
    const lines = documentToLedgerLines("ManualJournals", doc, filter, "GBP", accounts);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sourceType: "MANJOURNAL", reference: "VAT reclass", net: -50 });
    expect(summariseLedger(lines)).toMatchObject({ totalDebit: 0, totalCredit: 50, net: -50 });
  });
});

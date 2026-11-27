import { beforeEach, describe, expect, it, vi } from "vitest";

const accountingApi = vi.hoisted(() => ({
  getInvoices: vi.fn(),
  getBankTransactions: vi.fn(),
  getPayments: vi.fn(),
}));

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    tenantId: "tenant-id",
    accountingApi,
  },
}));

import { listXeroInvoices } from "../list-xero-invoices.handler.js";
import { listXeroBankTransactions } from "../list-xero-bank-transactions.handler.js";
import { listXeroPayments, paymentsWhere } from "../list-xero-payments.handler.js";

const ACCOUNT = "11111111-2222-4333-8444-555555555555";

describe("list handlers with filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountingApi.getInvoices.mockResolvedValue({ body: { invoices: [] } });
    accountingApi.getBankTransactions.mockResolvedValue({ body: { bankTransactions: [] } });
    accountingApi.getPayments.mockResolvedValue({ body: { payments: [] } });
  });

  it("list-invoices without filters asks exactly what it asked before (no where, no statuses, 10 a page)", async () => {
    await listXeroInvoices(3, ["c"], undefined);
    const args = accountingApi.getInvoices.mock.calls[0];
    expect(args[2]).toBeUndefined(); // where
    expect(args[6]).toEqual(["c"]); // contactIDs
    expect(args[7]).toBeUndefined(); // statuses
    expect(args[8]).toBe(3); // page
    expect(args[13]).toBe(10); // pageSize
  });

  it("list-invoices passes statuses, the date range and the page size", async () => {
    await listXeroInvoices(1, undefined, undefined, { statuses: ["AUTHORISED", "DRAFT"], fromDate: "2026-11-01", toDate: "2026-11-30", pageSize: 100 });
    const args = accountingApi.getInvoices.mock.calls[0];
    expect(args[2]).toBe("Date >= DateTime(2026, 11, 01) AND Date <= DateTime(2026, 11, 30)");
    expect(args[7]).toEqual(["AUTHORISED", "DRAFT"]);
    expect(args[13]).toBe(100);
  });

  it("list-bank-transactions joins the account, the statuses and the dates", async () => {
    await listXeroBankTransactions(2, ACCOUNT, { statuses: ["AUTHORISED"], fromDate: "2026-11-01", pageSize: 50 });
    const args = accountingApi.getBankTransactions.mock.calls[0];
    expect(args[2]).toBe(`BankAccount.AccountID=guid("${ACCOUNT}") AND Status=="AUTHORISED" AND Date >= DateTime(2026, 11, 01)`);
    expect(args[4]).toBe(2);
    expect(args[6]).toBe(50);
  });

  it("list-bank-transactions without filters keeps the old request", async () => {
    await listXeroBankTransactions(1);
    const args = accountingApi.getBankTransactions.mock.calls[0];
    expect(args[2]).toBeUndefined();
    expect(args[6]).toBe(10);
  });

  it("list-bank-transactions refuses an account that is not an ID, before calling Xero", async () => {
    const r = await listXeroBankTransactions(1, 'x") OR (1==1');
    expect(r.isError).toBe(true);
    expect(accountingApi.getBankTransactions).not.toHaveBeenCalled();
  });

  it("list-payments filters by status and date, with the page size", async () => {
    await listXeroPayments(1, { statuses: ["AUTHORISED"], fromDate: "2026-11-01", toDate: "2026-11-05", pageSize: 100 });
    const args = accountingApi.getPayments.mock.calls[0];
    expect(args[2]).toBe('Status=="AUTHORISED" AND Date >= DateTime(2026, 11, 01) AND Date <= DateTime(2026, 11, 05)');
    expect(args[5]).toBe(100);
  });

  it("list-payments keeps the old filters and refuses values that would change the expression", async () => {
    expect(paymentsWhere({ invoiceId: ACCOUNT, reference: "OP 12" })).toBe(`Invoice.InvoiceID==guid("${ACCOUNT}") AND Reference=="OP 12"`);
    expect(paymentsWhere({})).toBeUndefined();
    expect(() => paymentsWhere({ invoiceNumber: 'A" OR Amount>0 OR "' })).toThrow(/double quote/);
    expect(() => paymentsWhere({ paymentId: "abc" })).toThrow(/GUID/);
    const r = await listXeroPayments(1, { invoiceId: "nope" });
    expect(r.isError).toBe(true);
    expect(accountingApi.getPayments).not.toHaveBeenCalled();
  });
});

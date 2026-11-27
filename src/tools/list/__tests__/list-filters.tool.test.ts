import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  listXeroInvoices: vi.fn(),
  listXeroPayments: vi.fn(),
  listXeroBankTransactions: vi.fn(),
}));
vi.mock("../../../handlers/list-xero-invoices.handler.js", () => ({ listXeroInvoices: handlers.listXeroInvoices }));
vi.mock("../../../handlers/list-xero-payments.handler.js", () => ({ listXeroPayments: handlers.listXeroPayments }));
vi.mock("../../../handlers/list-xero-bank-transactions.handler.js", () => ({ listXeroBankTransactions: handlers.listXeroBankTransactions }));

import ListInvoicesTool from "../list-invoices.tool.js";
import ListPaymentsTool, { paymentFormatter } from "../list-payments.tool.js";
import ListBankTransactionsTool from "../list-bank-transactions.tool.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (tool: () => { handler: any }, args: Record<string, unknown>) => {
  const result = await tool().handler(args, {});
  return result.content[0].text as string;
};
const ok = (result: unknown[]) => ({ result, isError: false, error: null });

describe("list tools print the page they applied", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list-invoices prints page, page size and filters under the count", async () => {
    handlers.listXeroInvoices.mockResolvedValue(ok([{ invoiceID: "i1", invoiceNumber: "INV-1", status: "AUTHORISED", total: 5 }]));
    const text = await run(ListInvoicesTool, { page: 2, statuses: ["AUTHORISED"], pageSize: 100 });
    expect(text.split("\n").slice(0, 2)).toEqual(["Found 1 invoice.", "Page 2, page size 100. Filters: statuses AUTHORISED."]);
    expect(handlers.listXeroInvoices).toHaveBeenCalledWith(2, undefined, undefined, { statuses: ["AUTHORISED"], fromDate: undefined, toDate: undefined, pageSize: 100 });
  });

  it("an empty page still says which page size it used", async () => {
    handlers.listXeroInvoices.mockResolvedValue(ok([]));
    expect(await run(ListInvoicesTool, { page: 1 })).toBe("Found 0 invoices.\nPage 1, page size 10.");
  });

  it("a range the wrong way round is refused before Xero is called", async () => {
    const text = await run(ListPaymentsTool, { page: 1, fromDate: "2026-11-30", toDate: "2026-11-01" });
    expect(text).toMatch(/^Error listing payments: fromDate 2026-11-30 is after toDate 2026-11-01/);
    expect(handlers.listXeroPayments).not.toHaveBeenCalled();
  });

  it("list-bank-transactions names the account filter", async () => {
    handlers.listXeroBankTransactions.mockResolvedValue(ok([]));
    expect(await run(ListBankTransactionsTool, { page: 1, bankAccountId: "acc", fromDate: "2026-11-01" }))
      .toBe("Found 0 bank transactions.\nPage 1, page size 10. Filters: account acc; from 2026-11-01.");
  });

  it("a payment's bank account is printed also when Xero gives no account name, with the reconciliation status", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = paymentFormatter({ paymentID: "p1", amount: 12.5, account: { accountID: "acc-1", code: "090" }, isReconciled: false } as any);
    expect(text).toContain("Account: 090 (acc-1)");
    expect(text).toContain("Reconciliation Status: Unreconciled");
  });
});

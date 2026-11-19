import { beforeEach, describe, expect, it, vi } from "vitest";

const accountingApi = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  updateInvoice: vi.fn(),
}));

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    tenantId: "tenant-id",
    accountingApi,
  },
}));

import { deleteXeroInvoice } from "../delete-xero-invoice.handler.js";

const ID = "invoice-id";

function mockExisting(overrides: Record<string, unknown> = {}) {
  accountingApi.getInvoice.mockResolvedValue({
    body: {
      invoices: [
        { invoiceID: ID, status: "DRAFT", amountPaid: 0, amountCredited: 0, ...overrides },
      ],
    },
  });
}

describe("deleteXeroInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends only the ID and DELETED status for a draft", async () => {
    mockExisting({ invoiceNumber: "INV-1" });
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "DELETED" }] },
    });

    const response = await deleteXeroInvoice(ID);

    expect(response.isError).toBe(false);
    expect(response.result?.status).toBe("DELETED");
    expect(accountingApi.updateInvoice).toHaveBeenCalledTimes(1);
    const [, idArg, payload] = accountingApi.updateInvoice.mock.calls[0];
    expect(idArg).toBe(ID);
    expect(payload.invoices[0]).toEqual({ invoiceID: ID, status: "DELETED" });
  });

  it("deletes an invoice awaiting approval", async () => {
    mockExisting({ status: "SUBMITTED" });
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "DELETED" }] },
    });

    const response = await deleteXeroInvoice(ID);

    expect(response.isError).toBe(false);
  });

  it.each([
    [{ status: "AUTHORISED" }, /status is AUTHORISED.*void-invoice/],
    [{ status: "PAID", amountPaid: 100 }, /status is PAID/],
    [{ status: "VOIDED" }, /status is VOIDED/],
    [{ status: "DELETED" }, /already deleted/],
    [{ amountPaid: 10 }, /payments or credits/],
    [{ amountCredited: 5 }, /payments or credits/],
  ])("refuses %o without calling Xero's update", async (overrides, message) => {
    mockExisting(overrides);

    const response = await deleteXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(message);
    expect(accountingApi.updateInvoice).not.toHaveBeenCalled();
  });

  it("reports an invoice that does not exist", async () => {
    accountingApi.getInvoice.mockResolvedValue({ body: { invoices: [] } });

    const response = await deleteXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/Could not find invoice/);
    expect(accountingApi.updateInvoice).not.toHaveBeenCalled();
  });

  it("does not report success when Xero does not confirm DELETED", async () => {
    mockExisting();
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "DRAFT" }] },
    });

    const response = await deleteXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/did not confirm the deletion; status is DRAFT/);
  });

  it("surfaces Xero validation errors from a rejected update", async () => {
    mockExisting();
    accountingApi.updateInvoice.mockRejectedValue({
      response: {
        body: { Elements: [{ ValidationErrors: [{ Message: "Cannot delete this invoice" }] }] },
      },
    });

    const response = await deleteXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toBe("Cannot delete this invoice");
  });
});

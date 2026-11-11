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

import { voidXeroInvoice } from "../void-xero-invoice.handler.js";

const ID = "invoice-id";

function mockExisting(overrides: Record<string, unknown> = {}) {
  accountingApi.getInvoice.mockResolvedValue({
    body: {
      invoices: [
        { invoiceID: ID, status: "AUTHORISED", amountPaid: 0, amountCredited: 0, ...overrides },
      ],
    },
  });
}

describe("voidXeroInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends only the ID and VOIDED status for an unpaid approved invoice", async () => {
    mockExisting({ invoiceNumber: "INV-1" });
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "VOIDED" }] },
    });

    const response = await voidXeroInvoice(ID);

    expect(response.isError).toBe(false);
    expect(response.result?.status).toBe("VOIDED");
    const [, idArg, payload] = accountingApi.updateInvoice.mock.calls[0];
    expect(idArg).toBe(ID);
    expect(payload.invoices[0]).toEqual({ invoiceID: ID, status: "VOIDED" });
  });

  it("voids an invoice awaiting approval", async () => {
    mockExisting({ status: "SUBMITTED" });
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "VOIDED" }] },
    });

    const response = await voidXeroInvoice(ID);

    expect(response.isError).toBe(false);
  });

  it.each([
    [{ amountPaid: 10 }, /payments or credits/],
    [{ amountCredited: 5 }, /payments or credits/],
    [{ status: "PAID", amountPaid: 100 }, /status is PAID/],
    [{ status: "DRAFT" }, /status is DRAFT/],
    [{ status: "VOIDED" }, /already voided/],
  ])("refuses %o without calling Xero's update", async (overrides, message) => {
    mockExisting(overrides);

    const response = await voidXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(message);
    expect(accountingApi.updateInvoice).not.toHaveBeenCalled();
  });

  it("surfaces Xero validation errors from a rejected update", async () => {
    mockExisting();
    accountingApi.updateInvoice.mockRejectedValue({
      response: {
        statusCode: 400,
        body: {
          Detail: "A validation exception occurred",
          Elements: [{ ValidationErrors: [{ Message: "Invoice cannot be voided." }] }],
        },
      },
    });

    const response = await voidXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toBe("Invoice cannot be voided.");
  });

  it("fails when Xero does not confirm the void", async () => {
    mockExisting();
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "AUTHORISED" }] },
    });

    const response = await voidXeroInvoice(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/did not confirm/);
  });
});

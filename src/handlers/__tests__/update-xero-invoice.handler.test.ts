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

import { updateXeroInvoice } from "../update-xero-invoice.handler.js";

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

describe("updateXeroInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "AUTHORISED", currencyCode: "USD" }] },
    });
  });

  it.each(["DRAFT", "SUBMITTED", "AUTHORISED"])("sends the update to Xero for a %s invoice", async (status) => {
    mockExisting({ status });

    const response = await updateXeroInvoice(ID, undefined, undefined, undefined, undefined, undefined, {
      currencyCode: "usd",
    });

    expect(response.isError).toBe(false);
    const [, idArg, payload] = accountingApi.updateInvoice.mock.calls[0];
    expect(idArg).toBe(ID);
    expect(payload.invoices[0]).toMatchObject({ currencyCode: "USD" });
  });

  it.each([
    [{ amountPaid: 10 }, /payments/],
    [{ amountCredited: 5 }, /credits/],
    [{ status: "PAID", amountPaid: 0 }, /PAID/],
    [{ status: "VOIDED" }, /VOIDED/],
    [{ status: "DELETED" }, /DELETED/],
  ])("refuses %o without calling Xero's update", async (overrides, message) => {
    mockExisting(overrides);

    const response = await updateXeroInvoice(ID, undefined, "REF");

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(message);
    expect(accountingApi.updateInvoice).not.toHaveBeenCalled();
  });
});

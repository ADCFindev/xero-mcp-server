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

describe("updateXeroInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the update straight to Xero without checking the invoice's status", async () => {
    accountingApi.updateInvoice.mockResolvedValue({
      body: { invoices: [{ invoiceID: ID, status: "AUTHORISED", currencyCode: "USD" }] },
    });

    const response = await updateXeroInvoice(ID, undefined, undefined, undefined, undefined, undefined, {
      currencyCode: "usd",
    });

    expect(response.isError).toBe(false);
    expect(accountingApi.getInvoice).not.toHaveBeenCalled();
    const [, idArg, payload] = accountingApi.updateInvoice.mock.calls[0];
    expect(idArg).toBe(ID);
    expect(payload.invoices[0]).toMatchObject({ currencyCode: "USD" });
  });

  it("passes Xero's refusal back as the error", async () => {
    accountingApi.updateInvoice.mockRejectedValue({
      response: {
        statusCode: 400,
        body: {
          Message: "A validation exception occurred",
          Elements: [{ ValidationErrors: [{ Message: "Invoice not of valid status for modification" }] }],
        },
      },
    });

    const response = await updateXeroInvoice(ID, undefined, "REF");

    expect(response.isError).toBe(true);
    expect(response.error).toBe(
      "400 A validation exception occurred: Invoice not of valid status for modification",
    );
  });
});

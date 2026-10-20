import { beforeEach, describe, expect, it, vi } from "vitest";

const accountingApi = vi.hoisted(() => ({
  createPayment: vi.fn(),
}));

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    tenantId: "tenant-id",
    accountingApi,
  },
}));

import { createXeroPayment } from "../create-xero-payment.handler.js";

describe("createXeroPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountingApi.createPayment.mockResolvedValue({
      body: { payments: [{ paymentID: "payment-id" }] },
    });
  });

  it("sends bankAmount when the bank account's currency differs", async () => {
    await createXeroPayment({ invoiceId: "inv", accountId: "acc", amount: 100, bankAmount: 127.5 });

    const [, payment] = accountingApi.createPayment.mock.calls[0];
    expect(payment).toMatchObject({ amount: 100, bankAmount: 127.5 });
    expect(payment).not.toHaveProperty("currencyRate");
  });

  it("leaves bankAmount and currencyRate out when not given", async () => {
    await createXeroPayment({ invoiceId: "inv", accountId: "acc", amount: 100 });

    const [, payment] = accountingApi.createPayment.mock.calls[0];
    expect(payment).not.toHaveProperty("bankAmount");
    expect(payment).not.toHaveProperty("currencyRate");
  });
});

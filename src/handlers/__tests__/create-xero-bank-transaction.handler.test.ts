import { beforeEach, describe, expect, it, vi } from "vitest";

const accountingApi = vi.hoisted(() => ({
  createBankTransactions: vi.fn(),
}));

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    tenantId: "tenant-id",
    accountingApi,
  },
}));

import { createXeroBankTransaction } from "../create-xero-bank-transaction.handler.js";

describe("createXeroBankTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountingApi.createBankTransactions.mockResolvedValue({
      body: { bankTransactions: [{ bankTransactionID: "bt-id" }] },
    });
  });

  it.each([
    ["SPEND", "SPEND"],
    ["SPEND-OVERPAYMENT", "SPEND-OVERPAYMENT"],
    ["RECEIVE-PREPAYMENT", "RECEIVE-PREPAYMENT"],
  ] as const)("sends type %s to Xero as %s", async (type, expected) => {
    const response = await createXeroBankTransaction(type, "bank-id", "contact-id", [
      { description: "Google Ads", quantity: 1, unitAmount: 50 },
    ]);

    expect(response.isError).toBe(false);
    const [, payload] = accountingApi.createBankTransactions.mock.calls[0];
    expect(payload.bankTransactions[0].type).toBe(expected);
  });
});

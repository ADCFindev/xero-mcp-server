import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("axios", () => ({ default: http, AxiosError: class AxiosError extends Error {} }));
vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    readTokenSet: () => ({ access_token: "token" }),
    tenantId: "tenant-id",
  },
}));

import { createXeroBankTransfer } from "../xero-bank-transfers-api.js";

describe("createXeroBankTransfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http.put.mockResolvedValue({ data: { BankTransfers: [{ BankTransferID: "transfer-id" }] } });
  });

  it("sends CurrencyRate when the accounts have different currencies", async () => {
    await createXeroBankTransfer({ fromBankAccountId: "eur", toBankAccountId: "usd", amount: 17.58, currencyRate: 1.1377 });

    const [, body] = http.put.mock.calls[0];
    expect(body.BankTransfers[0]).toMatchObject({ Amount: 17.58, CurrencyRate: 1.1377 });
  });

  it("leaves CurrencyRate out when not given", async () => {
    await createXeroBankTransfer({ fromBankAccountId: "a", toBankAccountId: "b", amount: 10 });

    const [, body] = http.put.mock.calls[0];
    expect(body.BankTransfers[0]).not.toHaveProperty("CurrencyRate");
  });
});

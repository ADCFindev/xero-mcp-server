import { beforeEach, describe, expect, it, vi } from "vitest";

const accountingApi = vi.hoisted(() => ({
  getBankTransaction: vi.fn(),
  updateBankTransaction: vi.fn(),
}));

vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    tenantId: "tenant-id",
    accountingApi,
  },
}));

import { deleteXeroBankTransaction } from "../delete-xero-bank-transaction.handler.js";

const ID = "bank-transaction-id";

function mockExisting(overrides: Record<string, unknown> = {}) {
  accountingApi.getBankTransaction.mockResolvedValue({
    body: {
      bankTransactions: [
        { bankTransactionID: ID, status: "AUTHORISED", isReconciled: false, ...overrides },
      ],
    },
  });
}

describe("deleteXeroBankTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the status to DELETED on an unreconciled transaction", async () => {
    mockExisting({ reference: "REF-1" });
    accountingApi.updateBankTransaction.mockResolvedValue({
      body: { bankTransactions: [{ bankTransactionID: ID, status: "DELETED" }] },
    });

    const response = await deleteXeroBankTransaction(ID);

    expect(response.isError).toBe(false);
    expect(response.result?.status).toBe("DELETED");
    const [, idArg, payload] = accountingApi.updateBankTransaction.mock.calls[0];
    expect(idArg).toBe(ID);
    expect(payload.bankTransactions[0]).toMatchObject({
      bankTransactionID: ID,
      status: "DELETED",
      reference: "REF-1",
    });
  });

  it("refuses a reconciled transaction without calling Xero's update", async () => {
    mockExisting({ isReconciled: true });

    const response = await deleteXeroBankTransaction(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/reconciled/);
    expect(accountingApi.updateBankTransaction).not.toHaveBeenCalled();
  });

  it("refuses a transaction that is already deleted", async () => {
    mockExisting({ status: "DELETED" });

    const response = await deleteXeroBankTransaction(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/already deleted/);
    expect(accountingApi.updateBankTransaction).not.toHaveBeenCalled();
  });

  it("surfaces Xero validation errors from a rejected update", async () => {
    mockExisting();
    accountingApi.updateBankTransaction.mockRejectedValue({
      response: {
        statusCode: 400,
        body: {
          Detail: "A validation exception occurred",
          Elements: [
            { ValidationErrors: [{ Message: "This Bank Transaction cannot be deleted." }] },
          ],
        },
      },
    });

    const response = await deleteXeroBankTransaction(ID);

    expect(response.isError).toBe(true);
    expect(response.error).toBe("This Bank Transaction cannot be deleted.");
  });
});

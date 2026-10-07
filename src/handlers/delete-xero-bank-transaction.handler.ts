import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { BankTransaction } from "xero-node";

interface XeroValidationErrorBody {
  Elements?: Array<{
    ValidationErrors?: Array<{ Message?: string }>;
  }>;
}

/**
 * Pull Xero's ValidationErrors out of an SDK error body. formatError only
 * reports the generic "A validation exception occurred" detail, which hides
 * the reason (e.g. the transaction being reconciled).
 */
function extractValidationMessages(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const body = (error as { response?: { body?: unknown } }).response?.body;
  if (typeof body !== "object" || body === null) return [];

  const messages: string[] = [];
  for (const element of (body as XeroValidationErrorBody).Elements ?? []) {
    for (const validationError of element.ValidationErrors ?? []) {
      if (validationError.Message) messages.push(validationError.Message);
    }
  }
  return messages;
}

async function getBankTransaction(
  bankTransactionId: string,
): Promise<BankTransaction | undefined> {
  const response = await xeroClient.accountingApi.getBankTransaction(
    xeroClient.tenantId, // xeroTenantId
    bankTransactionId, // bankTransactionID
    undefined, // unitdp
    getClientHeaders(), // options
  );

  return response.body.bankTransactions?.[0];
}

async function deleteBankTransaction(
  bankTransactionId: string,
  existingBankTransaction: BankTransaction,
): Promise<BankTransaction | undefined> {
  const bankTransaction: BankTransaction = {
    ...existingBankTransaction,
    bankTransactionID: bankTransactionId,
    status: BankTransaction.StatusEnum.DELETED,
  };

  const response = await xeroClient.accountingApi.updateBankTransaction(
    xeroClient.tenantId, // xeroTenantId
    bankTransactionId, // bankTransactionID
    { bankTransactions: [bankTransaction] }, // bankTransactions
    undefined, // unitdp
    undefined, // idempotencyKey
    getClientHeaders(), // options
  );

  return response.body.bankTransactions?.[0];
}

/**
 * Delete a bank transaction in Xero. The API has no hard delete; the
 * transaction's status is set to DELETED, which Xero only allows while the
 * transaction is unreconciled.
 */
export async function deleteXeroBankTransaction(
  bankTransactionId: string,
): Promise<XeroClientResponse<BankTransaction>> {
  try {
    await xeroClient.authenticate();

    const existingBankTransaction = await getBankTransaction(bankTransactionId);

    if (!existingBankTransaction) {
      throw new Error("Could not find bank transaction");
    }

    if (existingBankTransaction.status === BankTransaction.StatusEnum.DELETED) {
      throw new Error("Bank transaction is already deleted");
    }

    if (existingBankTransaction.isReconciled) {
      throw new Error(
        "Bank transaction is reconciled. Xero does not allow deleting reconciled bank transactions; unreconcile it in Xero first, then retry.",
      );
    }

    const deletedBankTransaction = await deleteBankTransaction(
      bankTransactionId,
      existingBankTransaction,
    );

    if (!deletedBankTransaction) {
      throw new Error("Failed to delete bank transaction");
    }

    const validationMessages = (deletedBankTransaction.validationErrors ?? [])
      .map((validationError) => validationError.message)
      .filter((message): message is string => Boolean(message));

    if (validationMessages.length > 0) {
      throw new Error(validationMessages.join(" "));
    }

    if (deletedBankTransaction.status !== BankTransaction.StatusEnum.DELETED) {
      throw new Error(
        `Xero did not confirm the deletion; status is ${deletedBankTransaction.status ?? "unknown"}`,
      );
    }

    return {
      result: deletedBankTransaction,
      isError: false,
      error: null,
    };
  } catch (error) {
    const validationMessages = extractValidationMessages(error);

    return {
      result: null,
      isError: true,
      error:
        validationMessages.length > 0
          ? validationMessages.join(" ")
          : formatError(error),
    };
  }
}

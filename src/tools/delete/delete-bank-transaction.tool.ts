import { z } from "zod";

import { deleteXeroBankTransaction } from "../../handlers/delete-xero-bank-transaction.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteBankTransactionTool = CreateXeroTool(
  "delete-bank-transaction",
  `Delete a Xero bank transaction (spend or receive money) by its BankTransactionID. This sets the transaction status to DELETED. Only unreconciled bank transactions can be deleted; a reconciled one must be unreconciled in Xero first. Bank transactions that belong to a bank transfer must be removed with delete-bank-transfer instead.`,
  {
    bankTransactionId: z
      .string()
      .describe("The Xero BankTransactionID of the bank transaction to delete."),
  },
  async ({ bankTransactionId }) => {
    const response = await deleteXeroBankTransaction(bankTransactionId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting bank transaction: ${response.error}`,
          },
        ],
      };
    }

    const bankTransaction = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Successfully deleted bank transaction: ${bankTransactionId}`,
            bankTransaction.reference
              ? `Reference: ${bankTransaction.reference}`
              : null,
            bankTransaction.date ? `Date: ${bankTransaction.date}` : null,
            bankTransaction.total !== undefined
              ? `Total: ${bankTransaction.total}`
              : null,
            `Status: ${bankTransaction.status}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default DeleteBankTransactionTool;

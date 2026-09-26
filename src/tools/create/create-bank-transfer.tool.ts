import { z } from "zod";

import { createXeroBankTransfer } from "../../handlers/xero-bank-transfers-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateBankTransferTool = CreateXeroTool(
  "create-bank-transfer",
  "Create a Xero BankTransfer between two bank accounts. Xero creates SPEND-TRANSFER and RECEIVE-TRANSFER BankTransactions automatically. Xero does not support bank transfers between accounts in different currencies through this endpoint. Read the transfer back after creation to verify it.",
  {
    fromBankAccountId: z
      .string()
      .describe("Xero Account ID of the source bank account."),
    toBankAccountId: z
      .string()
      .describe("Xero Account ID of the destination bank account."),
    amount: z
      .number()
      .positive()
      .describe("Amount transferred, expressed in the source bank account currency."),
    date: z
      .string()
      .optional()
      .describe("Optional transfer date in YYYY-MM-DD format. Xero defaults to today."),
    reference: z
      .string()
      .optional()
      .describe("Optional bank transfer reference."),
    fromIsReconciled: z
      .boolean()
      .optional()
      .describe("Optional reconciliation flag for the source-side generated bank transaction."),
    toIsReconciled: z
      .boolean()
      .optional()
      .describe("Optional reconciliation flag for the destination-side generated bank transaction."),
  },
  async ({
    fromBankAccountId,
    toBankAccountId,
    amount,
    date,
    reference,
    fromIsReconciled,
    toIsReconciled,
  }) => {
    const response = await createXeroBankTransfer({
      fromBankAccountId,
      toBankAccountId,
      amount,
      date,
      reference,
      fromIsReconciled,
      toIsReconciled,
    });

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating bank transfer: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Bank transfer created successfully.",
            JSON.stringify(response.result, null, 2),
            "Read the BankTransfer back from Xero and verify the source/destination BankTransactions before treating the write as confirmed.",
          ].join("\n"),
        },
      ],
    };
  },
);

export default CreateBankTransferTool;

import { z } from "zod";

import { deleteXeroBankTransfer } from "../../handlers/xero-bank-transfers-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteBankTransferTool = CreateXeroTool(
  "delete-bank-transfer",
  "Delete (reverse) a Xero BankTransfer by BankTransferID. Xero bank transfers cannot be edited; they can only be created or deleted. Read the transfer back after deletion to verify its status.",
  {
    bankTransferId: z
      .string()
      .describe("The Xero BankTransfer ID to delete."),
  },
  async ({ bankTransferId }) => {
    const response = await deleteXeroBankTransfer(bankTransferId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting bank transfer: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Successfully requested deletion of bank transfer: ${bankTransferId}`,
            JSON.stringify(response.result, null, 2),
            "Read the BankTransfer back from Xero to verify the reversal.",
          ].join("\n"),
        },
      ],
    };
  },
);

export default DeleteBankTransferTool;

import { z } from "zod";

import { getXeroBankTransfer } from "../../handlers/xero-bank-transfers-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetBankTransferTool = CreateXeroTool(
  "get-bank-transfer",
  "Get one Xero bank transfer by BankTransferID, including source account, destination account, amount, date, reconciliation flags and generated bank transaction IDs.",
  {
    bankTransferId: z
      .string()
      .describe("The Xero BankTransfer ID to retrieve."),
  },
  async ({ bankTransferId }) => {
    const response = await getXeroBankTransfer(bankTransferId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error getting bank transfer: ${response.error}`,
          },
        ],
      };
    }

    if (!response.result) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No bank transfer found for ID: ${bankTransferId}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default GetBankTransferTool;

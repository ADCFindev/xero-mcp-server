import { z } from "zod";

import { listXeroBankTransfers } from "../../handlers/xero-bank-transfers-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListBankTransfersTool = CreateXeroTool(
  "list-bank-transfers",
  "List Xero BankTransfer objects. A BankTransfer represents money moved between two Xero bank accounts and is distinct from Spend/Receive BankTransactions.",
  {
    where: z
      .string()
      .optional()
      .describe("Optional Xero where filter expression."),
    order: z
      .string()
      .optional()
      .describe("Optional Xero order expression, for example Date DESC."),
    includeDeleted: z
      .boolean()
      .optional()
      .describe("Set true to include deleted bank transfers."),
  },
  async ({ where, order, includeDeleted }) => {
    const response = await listXeroBankTransfers({
      where,
      order,
      includeDeleted,
    });

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing bank transfers: ${response.error}`,
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

export default ListBankTransfersTool;

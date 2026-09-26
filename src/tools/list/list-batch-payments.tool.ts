import { z } from "zod";

import { listXeroBatchPayments } from "../../handlers/xero-batch-payments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListBatchPaymentsTool = CreateXeroTool(
  "list-batch-payments",
  "List Xero batch payments. Batch payments group multiple invoice or bill payments into a single bank-account transaction. Optional Xero where and order expressions can be supplied.",
  {
    where: z
      .string()
      .optional()
      .describe('Optional Xero filter expression, for example Status=="AUTHORISED".'),
    order: z
      .string()
      .optional()
      .describe('Optional Xero order expression, for example Date DESC.'),
  },
  async ({ where, order }) => {
    const response = await listXeroBatchPayments(where, order);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing batch payments: ${response.error}`,
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

export default ListBatchPaymentsTool;

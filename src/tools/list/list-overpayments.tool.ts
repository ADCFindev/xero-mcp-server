import { z } from "zod";
import { listXeroOverpayments } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListOverpaymentsTool = CreateXeroTool(
  "list-overpayments",
  "List Xero overpayments, including type, contact, total, remaining credit and allocations.",
  {
    page: z.number().int().positive().optional(),
    where: z.string().optional().describe("Optional Xero where filter expression."),
    order: z.string().optional().describe("Optional Xero order expression."),
  },
  async ({ page, where, order }) => {
    const response = await listXeroOverpayments({ page, where, order });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error listing overpayments: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListOverpaymentsTool;

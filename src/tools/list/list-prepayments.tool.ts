import { z } from "zod";
import { listXeroPrepayments } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListPrepaymentsTool = CreateXeroTool(
  "list-prepayments",
  "List Xero prepayments, including type, contact, total, remaining credit and allocations.",
  {
    page: z.number().int().positive().optional(),
    where: z.string().optional().describe("Optional Xero where filter expression."),
    order: z.string().optional().describe("Optional Xero order expression."),
  },
  async ({ page, where, order }) => {
    const response = await listXeroPrepayments({ page, where, order });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error listing prepayments: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPrepaymentsTool;

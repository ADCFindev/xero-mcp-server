import { z } from "zod";
import { getXeroOverpayment } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetOverpaymentTool = CreateXeroTool(
  "get-overpayment",
  "Get one Xero overpayment by OverpaymentID, including remaining credit and allocations.",
  { overpaymentId: z.string().describe("The Xero Overpayment ID.") },
  async ({ overpaymentId }) => {
    const response = await getXeroOverpayment(overpaymentId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting overpayment: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetOverpaymentTool;

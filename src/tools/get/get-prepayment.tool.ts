import { z } from "zod";
import { getXeroPrepayment } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { normalizeXeroOutput } from "../../helpers/format-xero-output.js";

const GetPrepaymentTool = CreateXeroTool(
  "get-prepayment",
  "Get one Xero prepayment by PrepaymentID, including remaining credit and allocations.",
  { prepaymentId: z.string().describe("The Xero Prepayment ID.") },
  async ({ prepaymentId }) => {
    const response = await getXeroPrepayment(prepaymentId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting prepayment: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(normalizeXeroOutput(response.result), null, 2) }] };
  },
);

export default GetPrepaymentTool;

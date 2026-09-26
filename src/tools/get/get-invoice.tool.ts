import { z } from "zod";
import { getXeroInvoice } from "../../handlers/xero-single-read-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetInvoiceTool = CreateXeroTool(
  "get-invoice",
  "Get one Xero invoice or bill by InvoiceID. Returns the full Xero record for read-back verification.",
  { invoiceId: z.string().describe("The Xero Invoice ID.") },
  async ({ invoiceId }) => {
    const response = await getXeroInvoice(invoiceId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting invoice: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetInvoiceTool;

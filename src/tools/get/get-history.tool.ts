import { z } from "zod";
import { getXeroHistory, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const GetHistoryTool = CreateXeroTool(
  "get-history",
  "Get Xero History & Notes for one invoice/bill, credit note, or bank transaction by exact Xero ID.",
  {
    resource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    resourceId: z.string().describe("Exact Xero resource ID."),
  },
  async ({ resource, resourceId }) => {
    const response = await getXeroHistory(resource as SupportedDocumentResource, resourceId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting history: ${response.error}` }] };
    }
    const history = response.result ?? [];
    return {
      content: [{
        type: "text" as const,
        text: history.length === 0
          ? "Found 0 history records."
          : `Found ${history.length} ${history.length === 1 ? "history record" : "history records"}.\n${JSON.stringify(history, null, 2)}`,
      }],
    };
  },
);

export default GetHistoryTool;

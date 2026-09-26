import { z } from "zod";
import { listXeroAttachments, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const ListAttachmentsTool = CreateXeroTool(
  "list-attachments",
  "List Xero attachments for one invoice/bill, credit note, or bank transaction by exact Xero ID.",
  {
    resource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    resourceId: z.string().describe("Exact Xero resource ID."),
  },
  async ({ resource, resourceId }) => {
    const response = await listXeroAttachments(resource as SupportedDocumentResource, resourceId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error listing attachments: ${response.error}` }] };
    }
    const attachments = response.result ?? [];
    return {
      content: [{
        type: "text" as const,
        text: attachments.length === 0
          ? "Found 0 attachments."
          : `Found ${attachments.length} ${attachments.length === 1 ? "attachment" : "attachments"}.\n${JSON.stringify(attachments, null, 2)}`,
      }],
    };
  },
);

export default ListAttachmentsTool;

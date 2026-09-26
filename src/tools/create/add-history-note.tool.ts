import { z } from "zod";
import { addXeroHistoryNote, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const AddHistoryNoteTool = CreateXeroTool(
  "add-history-note",
  "Add a History & Notes entry to one Xero invoice/bill, credit note, or bank transaction. The tool automatically reads history back and verifies the exact note text before confirming success.",
  {
    resource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    resourceId: z.string().describe("Exact Xero resource ID."),
    details: z.string().min(1).describe("The exact note text to add."),
  },
  async ({ resource, resourceId, details }) => {
    const response = await addXeroHistoryNote({
      resource: resource as SupportedDocumentResource,
      resourceId,
      details,
    });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error adding history note: ${response.error}` }] };
    }
    return {
      content: [{
        type: "text" as const,
        text: [
          "History note added and verified by read-back.",
          JSON.stringify(response.result, null, 2),
        ].join("\n"),
      }],
    };
  },
);

export default AddHistoryNoteTool;

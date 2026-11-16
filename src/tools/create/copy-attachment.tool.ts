import { z } from "zod";
import { copyXeroAttachment, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const CopyAttachmentTool = CreateXeroTool(
  "copy-attachment",
  "Copy one attachment from a Xero invoice/bill, credit note or bank transaction to another, on the server (the file does not pass through you). " +
    "Identify the source file with attachmentId or fileName from list-attachments; both can be omitted when the source has exactly one attachment. " +
    "Idempotent: a file with the same name and size already on the target is reported as attached and not uploaded again; a different file with the same name is refused. " +
    "The upload is read back from the target and its size compared with the source. Files over 10 MB are refused. The source is left untouched.",
  {
    fromResource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    fromResourceId: z.string().describe("Exact Xero ID of the document that has the file."),
    toResource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    toResourceId: z.string().describe("Exact Xero ID of the document that should get the file."),
    attachmentId: z.string().optional().describe("AttachmentID from list-attachments."),
    fileName: z.string().optional().describe("Exact FileName from list-attachments; used when attachmentId is omitted."),
    toFileName: z.string().optional().describe("Name to give the file on the target; defaults to the source file name."),
  },
  async ({ fromResource, fromResourceId, toResource, toResourceId, attachmentId, fileName, toFileName }) => {
    const response = await copyXeroAttachment({
      fromResource: fromResource as SupportedDocumentResource,
      fromResourceId,
      toResource: toResource as SupportedDocumentResource,
      toResourceId,
      attachmentId,
      fileName,
      toFileName,
    });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error copying attachment: ${response.error}` }] };
    }
    const r = response.result;
    return {
      content: [{
        type: "text" as const,
        text: [
          r.alreadyAttached
            ? `Already attached: ${r.fileName} (${r.sizeBytes} bytes) is on the target; nothing was uploaded.`
            : `Copied ${r.fileName} (${r.mimeType}, ${r.sizeBytes} bytes) and verified it on the target by read-back.`,
          JSON.stringify({ attachmentsOnTarget: r.attachmentsOnTarget }, null, 2),
        ].join("\n"),
      }],
    };
  },
);

export default CopyAttachmentTool;

import { z } from "zod";
import { uploadXeroAttachment, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const UploadAttachmentTool = CreateXeroTool(
  "upload-attachment",
  "Upload an attachment to one Xero invoice/bill, credit note, or bank transaction. Content must be supplied as base64. The tool automatically reads attachments back and verifies the filename before confirming success.",
  {
    resource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    resourceId: z.string().describe("Exact Xero resource ID."),
    fileName: z.string().min(1),
    contentBase64: z.string().min(1).describe("Base64-encoded file content only, with no data: URL prefix."),
    contentType: z.string().optional().describe("MIME type, e.g. application/pdf or image/png."),
  },
  async ({ resource, resourceId, fileName, contentBase64, contentType }) => {
    const response = await uploadXeroAttachment({
      resource: resource as SupportedDocumentResource,
      resourceId,
      fileName,
      contentBase64,
      contentType,
    });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error uploading attachment: ${response.error}` }] };
    }
    return {
      content: [{
        type: "text" as const,
        text: [
          "Attachment uploaded and verified by read-back.",
          JSON.stringify(response.result, null, 2),
        ].join("\n"),
      }],
    };
  },
);

export default UploadAttachmentTool;

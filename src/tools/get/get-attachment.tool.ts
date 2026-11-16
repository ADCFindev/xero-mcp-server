import { z } from "zod";
import { getXeroAttachment, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const GetAttachmentTool = CreateXeroTool(
  "get-attachment",
  "Download one attachment from a Xero invoice/bill, credit note, or bank transaction. " +
    "format \"view\" (default) returns images inline and PDFs/other files as an embedded file so you can read them. " +
    "format \"base64\" returns the raw base64 content as text, ready to pass to another tool such as a Gmail attachment's `content`, " +
    "a Drive upload, or upload-attachment. Identify the file with attachmentId or fileName from list-attachments; " +
    "both can be omitted when the document has exactly one attachment. Files over 10 MB are refused.",
  {
    resource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    resourceId: z.string().describe("Exact Xero resource ID."),
    attachmentId: z.string().optional().describe("AttachmentID from list-attachments."),
    fileName: z.string().optional().describe("Exact FileName from list-attachments; used when attachmentId is omitted."),
    format: z.enum(["view", "base64"]).optional().describe("\"view\" (default) to read the file, \"base64\" to get raw content for another tool."),
  },
  async ({ resource, resourceId, attachmentId, fileName, format }) => {
    const response = await getXeroAttachment({
      resource: resource as SupportedDocumentResource,
      resourceId,
      attachmentId,
      fileName,
    });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error downloading attachment: ${response.error}` }] };
    }

    const { attachment, contentBase64, sizeBytes } = response.result;
    const mimeType = attachment.MimeType || "application/octet-stream";
    const summary = `Attachment ${attachment.FileName} (${mimeType}, ${sizeBytes} bytes, AttachmentID ${attachment.AttachmentID}).`;

    if (format === "base64") {
      return {
        content: [
          { type: "text" as const, text: summary },
          { type: "text" as const, text: contentBase64 },
        ],
      };
    }

    if (mimeType.startsWith("image/")) {
      return {
        content: [
          { type: "text" as const, text: summary },
          { type: "image" as const, data: contentBase64, mimeType },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: summary },
        {
          type: "resource" as const,
          resource: {
            uri: `xero://${resource}/${resourceId}/Attachments/${attachment.AttachmentID}/${encodeURIComponent(attachment.FileName ?? "attachment")}`,
            mimeType,
            blob: contentBase64,
          },
        },
      ],
    };
  },
);

export default GetAttachmentTool;

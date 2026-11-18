import { z } from "zod";
import { attachXeroAttachmentFromUrl, SupportedDocumentResource } from "../../handlers/xero-document-extras-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const resourceSchema = z.enum(["Invoices", "CreditNotes", "BankTransactions"]);

const AttachFromUrlTool = CreateXeroTool(
  "attach-from-url",
  "Attach a file to one Xero invoice/bill, credit note or bank transaction by having the SERVER download it from a one-time https link, e.g. the download_url from the Google Workspace connector's drive_create_download_link, so the file never passes through you. " +
    "Only hosts listed in the server's ATTACHMENT_SOURCE_HOSTS are fetched. The download is checked against the sender's SHA-256 (and expectedSizeBytes when given), the upload is read back from Xero and its size compared. " +
    "Idempotent: the same name and size already on the document = nothing is uploaded; a different file under the same name is refused. Files over 10 MB are refused.",
  {
    resource: resourceSchema.describe("Invoices, CreditNotes, or BankTransactions."),
    resourceId: z.string().describe("Exact Xero ID of the document that should get the file."),
    sourceUrl: z.string().url().describe("One-time https download link of the file."),
    fileName: z.string().optional().describe("Name in Xero; defaults to the file name the source sends."),
    expectedSizeBytes: z.number().int().positive().optional().describe("Size of the file in Drive; the upload is refused if the download differs."),
    expectedSha256: z.string().optional().describe("Expected SHA-256 (hex); defaults to the one the source sends."),
  },
  async ({ resource, resourceId, sourceUrl, fileName, expectedSizeBytes, expectedSha256 }) => {
    const response = await attachXeroAttachmentFromUrl({
      resource: resource as SupportedDocumentResource,
      resourceId,
      sourceUrl,
      fileName,
      expectedSizeBytes,
      expectedSha256,
    });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error attaching file: ${response.error}` }] };
    }
    const r = response.result;
    return {
      content: [{
        type: "text" as const,
        text: [
          r.alreadyAttached
            ? `Already attached: ${r.fileName} (${r.sizeBytes} bytes) is on the document; nothing was uploaded.`
            : `Attached ${r.fileName} (${r.mimeType}, ${r.sizeBytes} bytes, SHA-256 ${r.sha256}) and verified its size in Xero by read-back.`,
          JSON.stringify({ attachmentsOnTarget: r.attachmentsOnTarget }, null, 2),
        ].join("\n"),
      }],
    };
  },
);

export default AttachFromUrlTool;

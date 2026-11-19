import { z } from "zod";

import { deleteXeroInvoice } from "../../handlers/delete-xero-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteInvoiceTool = CreateXeroTool(
  "delete-invoice",
  `Delete a draft invoice or bill in Xero by its InvoiceID. Only draft (DRAFT) or awaiting-approval (SUBMITTED) invoices with no payments or credits can be deleted; approved ones are voided with void-invoice. Deleting cannot be undone, so only use this when the user has asked for the specific invoice to be deleted, one invoice at a time, after showing its number, contact, date and total. Nothing else on the invoice is changed.`,
  {
    invoiceId: z.string().describe("The Xero InvoiceID of the draft invoice or bill to delete."),
  },
  async ({ invoiceId }) => {
    const response = await deleteXeroInvoice(invoiceId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting invoice: ${response.error}`,
          },
        ],
      };
    }

    const invoice = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Successfully deleted invoice: ${invoiceId}`,
            invoice.invoiceNumber ? `Invoice Number: ${invoice.invoiceNumber}` : null,
            invoice.contact?.name ? `Contact: ${invoice.contact.name}` : null,
            invoice.total !== undefined
              ? `Total: ${invoice.total} ${invoice.currencyCode ?? ""}`.trim()
              : null,
            `Status: ${invoice.status}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default DeleteInvoiceTool;

import { z } from "zod";
import { Invoice } from "xero-node";

import { voidXeroInvoice } from "../../handlers/void-xero-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";

const VoidInvoiceTool = CreateXeroTool(
  "void-invoice",
  `Void an invoice or bill in Xero by its InvoiceID. Only approved (AUTHORISED) or awaiting-approval (SUBMITTED) invoices with no payments or credits applied can be voided; drafts cannot. Voiding cannot be undone, so only use this when the user has asked for the specific invoice to be voided. Nothing else on the invoice is changed.`,
  {
    invoiceId: z.string().describe("The Xero InvoiceID of the invoice or bill to void."),
  },
  async ({ invoiceId }) => {
    const response = await voidXeroInvoice(invoiceId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error voiding invoice: ${response.error}`,
          },
        ],
      };
    }

    const invoice = response.result;

    const deepLink = invoice.invoiceID
      ? await getDeepLink(
          invoice.type === Invoice.TypeEnum.ACCREC ? DeepLinkType.INVOICE : DeepLinkType.BILL,
          invoice.invoiceID,
        ).catch(() => null)
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Successfully voided invoice: ${invoiceId}`,
            invoice.invoiceNumber ? `Invoice Number: ${invoice.invoiceNumber}` : null,
            invoice.contact?.name ? `Contact: ${invoice.contact.name}` : null,
            invoice.total !== undefined
              ? `Total: ${invoice.total} ${invoice.currencyCode ?? ""}`.trim()
              : null,
            `Status: ${invoice.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default VoidInvoiceTool;

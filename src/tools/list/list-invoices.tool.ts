import { z } from "zod";
import { listXeroInvoices } from "../../handlers/list-xero-invoices.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";
import { formatAmount, formatXeroDate } from "../../helpers/format-xero-output.js";

const ListInvoicesTool = CreateXeroTool(
  "list-invoices",
  "List invoices in Xero. This includes Draft, Submitted, and Paid invoices. Ask whether to filter by contact or invoice number when useful.",
  {
    page: z.number(),
    contactIds: z.array(z.string()).optional(),
    invoiceNumbers: z.array(z.string()).optional().describe("If provided, invoice line items will also be returned"),
  },
  async ({ page, contactIds, invoiceNumbers }) => {
    const response = await listXeroInvoices(page, contactIds, invoiceNumbers);
    if (response.error !== null) {
      return { content: [{ type: "text" as const, text: `Error listing invoices: ${response.error}` }] };
    }

    const invoices = response.result ?? [];
    const returnLineItems = (invoiceNumbers?.length ?? 0) > 0;

    if (invoices.length === 0) {
      return { content: [{ type: "text" as const, text: "Found 0 invoices." }] };
    }

    const header = `Found ${invoices.length} ${invoices.length === 1 ? "invoice" : "invoices"}.`;
    const records = invoices.map((invoice) =>
      [
        `Invoice ID: ${invoice.invoiceID || "(none)"}`,
        `Invoice: ${invoice.invoiceNumber || "(none)"}`,
        invoice.reference ? `Reference: ${invoice.reference}` : null,
        `Type: ${invoice.type || "Unknown"}`,
        `Status: ${invoice.status || "Unknown"}`,
        invoice.contact
          ? `Contact: ${invoice.contact.name || "(unnamed)"} (${invoice.contact.contactID || "Unknown ID"})`
          : null,
        invoice.date ? `Date: ${formatXeroDate(invoice.date)}` : null,
        invoice.dueDate ? `Due Date: ${formatXeroDate(invoice.dueDate)}` : null,
        invoice.lineAmountTypes ? `Line Amount Types: ${invoice.lineAmountTypes}` : null,
        invoice.subTotal !== undefined ? `Sub Total: ${formatAmount(invoice.subTotal)}` : null,
        invoice.totalTax !== undefined ? `Total Tax: ${formatAmount(invoice.totalTax)}` : null,
        `Total: ${formatAmount(invoice.total)}`,
        invoice.totalDiscount !== undefined ? `Total Discount: ${formatAmount(invoice.totalDiscount)}` : null,
        invoice.currencyCode ? `Currency: ${invoice.currencyCode}` : null,
        invoice.currencyRate !== undefined ? `Currency Rate: ${invoice.currencyRate}` : null,
        invoice.updatedDateUTC ? `Last Updated: ${formatXeroDate(invoice.updatedDateUTC)}` : null,
        invoice.fullyPaidOnDate ? `Fully Paid On: ${formatXeroDate(invoice.fullyPaidOnDate)}` : null,
        invoice.amountDue !== undefined ? `Amount Due: ${formatAmount(invoice.amountDue)}` : null,
        invoice.amountPaid !== undefined ? `Amount Paid: ${formatAmount(invoice.amountPaid)}` : null,
        invoice.amountCredited !== undefined ? `Amount Credited: ${formatAmount(invoice.amountCredited)}` : null,
        invoice.hasErrors ? "Has Errors: Yes" : null,
        invoice.isDiscounted ? "Is Discounted: Yes" : null,
        returnLineItems && invoice.lineItems?.length
          ? `Line Items:\n${invoice.lineItems.map(formatLineItem).join("\n\n")}`
          : null,
      ].filter(Boolean).join("\n"),
    );

    return {
      content: [{
        type: "text" as const,
        text: [header, ...records.map((record) => `---\n${record}`)].join("\n\n"),
      }],
    };
  },
);

export default ListInvoicesTool;

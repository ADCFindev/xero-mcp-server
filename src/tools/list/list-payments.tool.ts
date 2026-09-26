import { z } from "zod";
import { listXeroPayments } from "../../handlers/list-xero-payments.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Payment } from "xero-node";
import { formatAmount, formatXeroDate } from "../../helpers/format-xero-output.js";

function paymentFormatter(payment: Payment): string {
  return [
    `Payment ID: ${payment.paymentID || "Unknown"}`,
    `Date: ${formatXeroDate(payment.date) || "Unknown date"}`,
    `Amount: ${formatAmount(payment.amount)}`,
    payment.reference ? `Reference: ${payment.reference}` : null,
    payment.status ? `Status: ${payment.status}` : null,
    payment.paymentType ? `Payment Type: ${payment.paymentType}` : null,
    payment.updatedDateUTC ? `Last Updated: ${formatXeroDate(payment.updatedDateUTC)}` : null,
    payment.account?.name
      ? `Account: ${payment.account.name} (${payment.account.accountID || "Unknown ID"})`
      : null,
    payment.invoice
      ? [
          "Invoice:",
          `  Invoice Number: ${payment.invoice.invoiceNumber || "Unknown"}`,
          `  Invoice ID: ${payment.invoice.invoiceID || "Unknown"}`,
          payment.invoice.contact
            ? `  Contact: ${payment.invoice.contact.name || "Unknown"} (${payment.invoice.contact.contactID || "Unknown ID"})`
            : null,
          payment.invoice.type ? `  Type: ${payment.invoice.type}` : null,
          payment.invoice.total !== undefined ? `  Total: ${formatAmount(payment.invoice.total)}` : null,
          payment.invoice.amountDue !== undefined ? `  Amount Due: ${formatAmount(payment.invoice.amountDue)}` : null,
        ].filter(Boolean).join("\n")
      : null,
  ].filter(Boolean).join("\n");
}

const ListPaymentsTool = CreateXeroTool(
  "list-payments",
  "List payments in Xero, optionally filtered by invoice number, invoice ID, payment ID, or reference.",
  {
    page: z.number().default(1),
    invoiceNumber: z.string().optional(),
    invoiceId: z.string().optional(),
    paymentId: z.string().optional(),
    reference: z.string().optional(),
  },
  async ({ page, invoiceNumber, invoiceId, paymentId, reference }) => {
    const response = await listXeroPayments(page, { invoiceNumber, invoiceId, paymentId, reference });
    if (response.error !== null) {
      return { content: [{ type: "text" as const, text: `Error listing payments: ${response.error}` }] };
    }

    const payments = response.result ?? [];
    if (payments.length === 0) {
      return { content: [{ type: "text" as const, text: "Found 0 payments." }] };
    }

    const header = `Found ${payments.length} ${payments.length === 1 ? "payment" : "payments"}.`;
    const records = payments.map(paymentFormatter);

    return {
      content: [{
        type: "text" as const,
        text: [header, ...records.map((record) => `---\n${record}`)].join("\n\n"),
      }],
    };
  },
);

export default ListPaymentsTool;

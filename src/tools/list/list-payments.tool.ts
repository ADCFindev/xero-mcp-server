import { z } from "zod";
import { listXeroPayments } from "../../handlers/list-xero-payments.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Payment } from "xero-node";
import { formatAmount, formatXeroDate } from "../../helpers/format-xero-output.js";
import { DEFAULT_PAGE_SIZE, isoDay, pageLine, pageSizeArgument, rangeProblem } from "../../helpers/list-filters.js";

export function paymentFormatter(payment: Payment): string {
  return [
    `Payment ID: ${payment.paymentID || "Unknown"}`,
    `Date: ${formatXeroDate(payment.date) || "Unknown date"}`,
    `Amount: ${formatAmount(payment.amount)}`,
    payment.reference ? `Reference: ${payment.reference}` : null,
    payment.status ? `Status: ${payment.status}` : null,
    payment.paymentType ? `Payment Type: ${payment.paymentType}` : null,
    payment.updatedDateUTC ? `Last Updated: ${formatXeroDate(payment.updatedDateUTC)}` : null,
    // The bank account is printed whenever Xero gives it, also without a name (the list often has only the ID and code).
    payment.account
      ? `Account: ${payment.account.name || payment.account.code || "(unnamed)"} (${payment.account.accountID || "Unknown ID"})`
      : null,
    payment.isReconciled !== undefined
      ? `Reconciliation Status: ${payment.isReconciled ? "Reconciled" : "Unreconciled"}`
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
  "List payments in Xero, optionally filtered by invoice number, invoice ID, payment ID, reference, status and date range.",
  {
    page: z.number().default(1),
    invoiceNumber: z.string().optional(),
    invoiceId: z.string().optional(),
    paymentId: z.string().optional(),
    reference: z.string().optional(),
    statuses: z.array(z.enum(["AUTHORISED", "DELETED"])).optional()
      .describe("Only payments with these statuses, e.g. [\"AUTHORISED\"] (a deleted payment has status DELETED)"),
    fromDate: isoDay.optional().describe("Only payments dated on or after this day (YYYY-MM-DD)"),
    toDate: isoDay.optional().describe("Only payments dated on or before this day (YYYY-MM-DD)"),
    pageSize: pageSizeArgument,
  },
  async ({ page, invoiceNumber, invoiceId, paymentId, reference, statuses, fromDate, toDate, pageSize }) => {
    const problem = rangeProblem(fromDate, toDate);
    if (problem) {
      return { content: [{ type: "text" as const, text: `Error listing payments: ${problem}` }] };
    }
    const response = await listXeroPayments(page, { invoiceNumber, invoiceId, paymentId, reference, statuses, fromDate, toDate, pageSize });
    if (response.error !== null) {
      return { content: [{ type: "text" as const, text: `Error listing payments: ${response.error}` }] };
    }

    const payments = response.result ?? [];
    const paging = pageLine(page, pageSize ?? DEFAULT_PAGE_SIZE, { statuses, from: fromDate, to: toDate });
    if (payments.length === 0) {
      return { content: [{ type: "text" as const, text: `Found 0 payments.
${paging}` }] };
    }

    const header = `Found ${payments.length} ${payments.length === 1 ? "payment" : "payments"}.
${paging}`;
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

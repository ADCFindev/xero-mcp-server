import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listXeroBankTransactions } from "../../handlers/list-xero-bank-transactions.handler.js";
import { formatLineItem } from "../../helpers/format-line-item.js";
import { formatAmount, formatXeroDate } from "../../helpers/format-xero-output.js";

const ListBankTransactionsTool = CreateXeroTool(
  "list-bank-transactions",
  "List bank transactions in Xero, optionally filtered by bank account.",
  {
    page: z.number(),
    bankAccountId: z.string().optional(),
  },
  async ({ bankAccountId, page }) => {
    const response = await listXeroBankTransactions(page, bankAccountId);
    if (response.isError) {
      return {
        content: [{ type: "text" as const, text: `Error listing bank transactions: ${response.error}` }],
      };
    }

    const bankTransactions = response.result ?? [];
    if (bankTransactions.length === 0) {
      return { content: [{ type: "text" as const, text: "Found 0 bank transactions." }] };
    }

    const header = `Found ${bankTransactions.length} ${bankTransactions.length === 1 ? "bank transaction" : "bank transactions"}.`;
    const records = bankTransactions.map((transaction) =>
      [
        `Bank Transaction ID: ${transaction.bankTransactionID || "(none)"}`,
        transaction.bankAccount
          ? `Bank Account: ${transaction.bankAccount.name || "(unnamed)"} (${transaction.bankAccount.accountID || "Unknown ID"})`
          : null,
        transaction.contact
          ? `Contact: ${transaction.contact.name || "(unnamed)"} (${transaction.contact.contactID || "Unknown ID"})`
          : null,
        transaction.reference ? `Reference: ${transaction.reference}` : null,
        transaction.type ? `Type: ${transaction.type}` : null,
        transaction.date ? `Date: ${formatXeroDate(transaction.date)}` : null,
        transaction.subTotal !== undefined ? `Sub Total: ${formatAmount(transaction.subTotal)}` : null,
        transaction.totalTax !== undefined ? `Total Tax: ${formatAmount(transaction.totalTax)}` : null,
        transaction.total !== undefined ? `Total: ${formatAmount(transaction.total)}` : null,
        transaction.isReconciled !== undefined
          ? `Reconciliation Status: ${transaction.isReconciled ? "Reconciled" : "Unreconciled"}`
          : null,
        transaction.currencyCode ? `Currency: ${transaction.currencyCode}` : null,
        `Status: ${transaction.status || "Unknown"}`,
        transaction.lineAmountTypes ? `Line Amount Types: ${transaction.lineAmountTypes}` : null,
        transaction.hasAttachments !== undefined
          ? `Attachments: ${transaction.hasAttachments ? "Yes" : "No"}`
          : null,
        transaction.lineItems?.length
          ? `Line Items:\n${transaction.lineItems.map(formatLineItem).join("\n\n")}`
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

export default ListBankTransactionsTool;

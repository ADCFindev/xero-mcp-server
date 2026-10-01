import { z } from "zod";

import { listXeroAccountTransactions } from "../../handlers/list-xero-account-transactions.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import {
  formatLedgerTable,
  formatSummaryTable,
  isValidIsoDate,
} from "../../helpers/account-transactions.js";

const text = (value: string) => ({ type: "text" as const, text: value });

const ListAccountTransactionsTool = CreateXeroTool(
  "list-account-transactions",
  "General ledger: every posted ledger line for one or more accounts in a date range — the equivalent of Xero's Account Transactions report. " +
    "Built from Xero journals, so it covers invoices, bills, credit notes, payments, spend/receive money, transfers, manual journals, payroll and conversions alike. " +
    "Drafts are never included. Net is signed: positive = debit, negative = credit. Ends with debits, credits and net movement per account.",
  {
    accountCodes: z
      .array(z.string())
      .min(1)
      .describe('Account codes, e.g. ["822"]. Account IDs (GUIDs) are also accepted, which is how to select accounts without a code.'),
    fromDate: z.string().describe("Start date, YYYY-MM-DD, inclusive (journal date)."),
    toDate: z.string().describe("End date, YYYY-MM-DD, inclusive (journal date)."),
    sourceTypes: z
      .array(z.string())
      .optional()
      .describe(
        "Optional journal source types to keep, e.g. ACCPAY, ACCREC, ACCPAYCREDIT, ACCRECCREDIT, ACCPAYPAYMENT, ACCRECPAYMENT, CASHPAID (spend money), CASHREC (receive money), TRANSFER, MANJOURNAL. SPEND and RECEIVE are accepted as aliases.",
      ),
    includeSourceDetails: z
      .boolean()
      .optional()
      .default(true)
      .describe("Resolve each line's source document to its invoice/bill number, reference and contact name (batched lookups). Default true."),
    format: z
      .enum(["table", "json"])
      .optional()
      .default("table")
      .describe('"table" (default, compact) or "json".'),
    createdSince: z
      .string()
      .optional()
      .describe(
        'Only scan journals created on or after this date (YYYY-MM-DD) to save API calls. Defaults to 90 days before fromDate. Pass "all" to scan every journal, e.g. when entries may have been posted long in advance of their date.',
      ),
    maxRows: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .default(400)
      .describe("Maximum ledger lines to print (default 400). The summary always covers every line."),
  },
  async ({ accountCodes, fromDate, toDate, sourceTypes, includeSourceDetails, format, createdSince, maxRows }) => {
    if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate)) {
      return { content: [text("fromDate and toDate must be valid dates in YYYY-MM-DD format.")], isError: true };
    }
    if (fromDate > toDate) {
      return { content: [text("fromDate must be on or before toDate.")], isError: true };
    }
    if (createdSince !== undefined && createdSince !== "all" && !isValidIsoDate(createdSince)) {
      return { content: [text('createdSince must be YYYY-MM-DD or "all".')], isError: true };
    }
    if (createdSince !== undefined && createdSince !== "all" && createdSince > toDate) {
      return { content: [text("createdSince must be on or before toDate.")], isError: true };
    }

    const response = await listXeroAccountTransactions({
      accountCodes,
      fromDate,
      toDate,
      sourceTypes,
      includeSourceDetails: includeSourceDetails ?? true,
      createdSince,
    });

    if (response.isError) {
      const hint = /401|403|Authentication failed|denied access|scope/i.test(response.error)
        ? " The Journals endpoint needs the accounting.journals.read scope: the Xero app must have Journals API access, the scope must be in XERO_SCOPES, and the organisation must be reconnected via connect-organisation so the token carries it."
        : "";
      return { content: [text(`Error listing account transactions: ${response.error}${hint}`)], isError: true };
    }

    const r = response.result;
    const accountLabel = r.accounts.length
      ? r.accounts.map((a) => `${a.code || "(no code)"} ${a.name}`).join(", ")
      : accountCodes.join(", ");
    const scanNote = r.scan.createdSince
      ? `Scanned ${r.scan.journalsScanned} journals created since ${r.scan.createdSince} (${r.scan.pages} page(s)). Entries created before then but dated in the period are not included; use createdSince "all" to be exhaustive.`
      : `Scanned all ${r.scan.journalsScanned} journals (${r.scan.pages} page(s)).`;
    const notes = [
      r.unknownAccounts.length ? `Not found in the chart of accounts: ${r.unknownAccounts.join(", ")}.` : "",
      ...r.warnings,
    ].filter(Boolean);

    if (format === "json") {
      const rows = r.lines.slice(0, maxRows);
      return {
        content: [
          text(
            JSON.stringify(
              {
                accounts: r.accounts,
                fromDate,
                toDate,
                currency: r.currency,
                lineCount: r.lines.length,
                linesShown: rows.length,
                lines: rows,
                summary: r.summary,
                scan: r.scan,
                notes,
              },
              null,
              2,
            ),
          ),
        ],
      };
    }

    const table = formatLedgerTable(r.lines, maxRows);
    const parts = [
      `Account Transactions: ${accountLabel} | ${fromDate} to ${toDate} | ${r.lines.length} line(s) | amounts in ${r.currency || "base currency"}, Net positive = debit`,
      r.lines.length ? table.text : "No posted ledger lines for these accounts in this period.",
      table.truncated ? `... ${table.truncated} more line(s) not shown (raise maxRows or narrow the period). The summary below covers all lines.` : "",
      `Summary\n${formatSummaryTable(r.summary)}`,
      scanNote,
      ...notes,
    ].filter(Boolean);

    return { content: [text(parts.join("\n\n"))] };
  },
);

export default ListAccountTransactionsTool;

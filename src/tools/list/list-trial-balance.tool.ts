import { z } from "zod";
import { listXeroTrialBalance } from "../../handlers/list-xero-trial-balance.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { compactTrialBalance } from "../../helpers/account-transactions.js";

const ListTrialBalanceTool = CreateXeroTool(
  "list-trial-balance",
  "Lists trial balance in Xero. This provides a snapshot of the general ledger, showing debit and credit balances for each account. " +
    'Default "compact" output is one line per account (code, name, debit, credit, YTD debit, YTD credit) grouped by section; "full" returns Xero\'s raw report rows.',
  {
    date: z.string().optional().describe("Optional date in YYYY-MM-DD format"),
    paymentsOnly: z.boolean().optional().describe("Optional flag to include only accounts with payments"),
    format: z
      .enum(["compact", "full"])
      .optional()
      .default("compact")
      .describe('"compact" (default) or "full" (raw report JSON with cell attributes; large).'),
    hideZero: z
      .boolean()
      .optional()
      .default(false)
      .describe("In compact output, leave out accounts whose four amounts are all zero."),
  },
  async (args) => {
    const response = await listXeroTrialBalance(args?.date, args?.paymentsOnly);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing trial balance: ${response.error}`,
          },
        ],
      };
    }

    const trialBalanceReport = response.result;
    const heading = [
      `Trial Balance Report: ${trialBalanceReport?.reportName || "Unnamed"}`,
      `Date: ${trialBalanceReport?.reportDate || "Not specified"}`,
      `Updated At: ${trialBalanceReport?.updatedDateUTC ? trialBalanceReport.updatedDateUTC.toISOString() : "Unknown"}`,
    ].join("\n");

    if (args?.format === "full") {
      return {
        content: [
          { type: "text" as const, text: heading },
          { type: "text" as const, text: JSON.stringify(trialBalanceReport.rows) },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `${heading}\n\n${compactTrialBalance(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trialBalanceReport.rows as any,
            { hideZero: args?.hideZero ?? false },
          )}`,
        },
      ],
    };
  },
);

export default ListTrialBalanceTool;

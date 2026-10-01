import { z } from "zod";
import { listXeroAccounts } from "../../handlers/list-xero-accounts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const cell = (value: unknown) => String(value ?? "").replace(/[|\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();

const ListAccountsTool = CreateXeroTool(
  "list-accounts",
  "Lists all accounts in Xero. Use this tool to get the account codes, names and IDs to be used when creating invoices in Xero. " +
    'Default "compact" output is one line per account (code, name, type, tax type, status, ID); "full" adds descriptions and other details.',
  {
    format: z
      .enum(["compact", "full"])
      .optional()
      .default("compact")
      .describe('"compact" (default) or "full".'),
    includeArchived: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include archived accounts (default true)."),
  },
  async (args) => {
    const response = await listXeroAccounts();
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing accounts: ${response.error}`,
          },
        ],
      };
    }

    const accounts = (response.result ?? []).filter(
      (account) => args?.includeArchived !== false || String(account.status) !== "ARCHIVED",
    );

    if (args?.format === "full") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${accounts.length} accounts:\n\n${accounts
              .map((account) =>
                [
                  `Account: ${account.name || "Unnamed"}`,
                  `Code: ${account.code || "No code"}`,
                  `ID: ${account.accountID || "No ID"}`,
                  `Type: ${account.type || "Unknown type"}`,
                  `Status: ${account.status || "Unknown status"}`,
                  account.description ? `Description: ${account.description}` : null,
                  account.taxType ? `Tax Type: ${account.taxType}` : null,
                  account.bankAccountNumber ? `Bank Account Number: ${account.bankAccountNumber}` : null,
                  account.currencyCode ? `Currency: ${account.currencyCode}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n\n")}`,
          },
        ],
      };
    }

    const lines = accounts.map((account) =>
      [account.code, account.name, account.type, account.taxType, account.status, account.accountID]
        .map(cell)
        .join(" | "),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${accounts.length} accounts:\nCode | Name | Type | Tax type | Status | Account ID\n${lines.join("\n")}`,
        },
      ],
    };
  },
);

export default ListAccountsTool;

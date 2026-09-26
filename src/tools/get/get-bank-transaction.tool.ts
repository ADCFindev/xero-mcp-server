import { z } from "zod";
import { getXeroBankTransaction } from "../../handlers/xero-single-read-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetBankTransactionTool = CreateXeroTool(
  "get-bank-transaction",
  "Get one Xero BankTransaction by BankTransactionID for exact read-back verification.",
  { bankTransactionId: z.string().describe("The Xero BankTransaction ID.") },
  async ({ bankTransactionId }) => {
    const response = await getXeroBankTransaction(bankTransactionId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting bank transaction: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetBankTransactionTool;

import { z } from "zod";

import { getXeroCreditNote } from "../../handlers/xero-credit-note-allocations-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetCreditNoteTool = CreateXeroTool(
  "get-credit-note",
  "Get one Xero credit note by CreditNoteID, including remaining credit, allocations, payments and status.",
  {
    creditNoteId: z.string().describe("The Xero CreditNote ID."),
  },
  async ({ creditNoteId }) => {
    const response = await getXeroCreditNote(creditNoteId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error getting credit note: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default GetCreditNoteTool;

import { z } from "zod";

import { allocateXeroCreditNote } from "../../handlers/xero-credit-note-allocations-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const AllocateCreditNoteTool = CreateXeroTool(
  "allocate-credit-note",
  "Allocate available credit from an AUTHORISED Xero credit note to a compatible outstanding invoice or bill for the same contact. Read both records back after the write.",
  {
    creditNoteId: z.string().describe("The Xero CreditNote ID."),
    invoiceId: z.string().describe("The Xero Invoice ID to receive the credit."),
    amount: z.number().positive().describe("Amount of credit to allocate."),
  },
  async ({ creditNoteId, invoiceId, amount }) => {
    const response = await allocateXeroCreditNote({
      creditNoteId,
      invoiceId,
      amount,
    });

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error allocating credit note: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Credit note allocation created successfully.",
            JSON.stringify(response.result, null, 2),
            "Read the credit note and invoice/bill back from Xero to verify the allocation.",
          ].join("\n"),
        },
      ],
    };
  },
);

export default AllocateCreditNoteTool;

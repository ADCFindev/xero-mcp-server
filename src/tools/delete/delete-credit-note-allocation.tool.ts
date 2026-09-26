import { z } from "zod";

import { deleteXeroCreditNoteAllocation } from "../../handlers/xero-credit-note-allocations-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteCreditNoteAllocationTool = CreateXeroTool(
  "delete-credit-note-allocation",
  "Delete a Xero credit note allocation by CreditNoteID and AllocationID. Read the credit note and invoice/bill back after deletion to verify the reversal.",
  {
    creditNoteId: z.string().describe("The Xero CreditNote ID."),
    allocationId: z.string().describe("The Xero Allocation ID to delete."),
  },
  async ({ creditNoteId, allocationId }) => {
    const response = await deleteXeroCreditNoteAllocation(
      creditNoteId,
      allocationId,
    );

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting credit note allocation: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Credit note allocation deleted successfully.",
            JSON.stringify(response.result, null, 2),
            "Read the credit note and invoice/bill back from Xero to verify the reversal.",
          ].join("\n"),
        },
      ],
    };
  },
);

export default DeleteCreditNoteAllocationTool;

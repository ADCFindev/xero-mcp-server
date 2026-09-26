import { z } from "zod";

import { deleteXeroBatchPayment } from "../../handlers/xero-batch-payments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteBatchPaymentTool = CreateXeroTool(
  "delete-batch-payment",
  "Delete (reverse) a Xero batch payment by BatchPayment ID. This reverses the grouped payments rather than erasing their audit history. Verify the batch status and affected invoices after deletion.",
  {
    batchPaymentId: z
      .string()
      .describe("The Xero BatchPayment ID to delete."),
  },
  async ({ batchPaymentId }) => {
    const response = await deleteXeroBatchPayment(batchPaymentId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting batch payment: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Successfully requested deletion of batch payment: ${batchPaymentId}`,
            JSON.stringify(response.result, null, 2),
            "Read the batch payment and affected invoices back from Xero to verify the reversal.",
          ].join("\n"),
        },
      ],
    };
  },
);

export default DeleteBatchPaymentTool;

import { z } from "zod";

import { deleteXeroPayment } from "../../handlers/delete-xero-payment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeletePaymentTool = CreateXeroTool(
  "delete-payment",
  `Delete (reverse) an existing Xero payment by its Payment ID. This sets the payment status to DELETED. Payments created via Batch Payments cannot be deleted with this tool.`,
  {
    paymentId: z.string().describe("The Xero Payment ID of the payment to delete."),
  },
  async (params: { paymentId: string }) => {
    const { paymentId } = params;
    const response = await deleteXeroPayment(paymentId);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error deleting payment: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted payment with ID: ${paymentId}`,
        },
      ],
    };
  },
);

export default DeletePaymentTool;

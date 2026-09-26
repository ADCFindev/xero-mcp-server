import { z } from "zod";
import { getXeroPayment } from "../../handlers/xero-single-read-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetPaymentTool = CreateXeroTool(
  "get-payment",
  "Get one Xero payment by PaymentID for exact read-back verification.",
  { paymentId: z.string().describe("The Xero Payment ID.") },
  async ({ paymentId }) => {
    const response = await getXeroPayment(paymentId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting payment: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetPaymentTool;

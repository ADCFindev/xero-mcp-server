import { z } from "zod";
import { allocateXeroOverpayment } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const AllocateOverpaymentTool = CreateXeroTool(
  "allocate-overpayment",
  "Allocate available credit from a Xero overpayment to an outstanding invoice or bill for the same contact and compatible document type. Read both documents back after the write.",
  {
    overpaymentId: z.string(),
    invoiceId: z.string(),
    amount: z.number().positive(),
  },
  async ({ overpaymentId, invoiceId, amount }) => {
    const response = await allocateXeroOverpayment({ overpaymentId, invoiceId, amount });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error allocating overpayment: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: ["Overpayment allocation created successfully.", JSON.stringify(response.result, null, 2), "Read the overpayment and invoice/bill back from Xero to verify the allocation."].join("\n") }] };
  },
);

export default AllocateOverpaymentTool;

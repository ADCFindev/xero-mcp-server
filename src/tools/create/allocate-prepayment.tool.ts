import { z } from "zod";
import { allocateXeroPrepayment } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const AllocatePrepaymentTool = CreateXeroTool(
  "allocate-prepayment",
  "Allocate available credit from a Xero prepayment to an outstanding invoice or bill for the same contact and compatible document type. Read both documents back after the write.",
  {
    prepaymentId: z.string(),
    invoiceId: z.string(),
    amount: z.number().positive(),
  },
  async ({ prepaymentId, invoiceId, amount }) => {
    const response = await allocateXeroPrepayment({ prepaymentId, invoiceId, amount });
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error allocating prepayment: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: ["Prepayment allocation created successfully.", JSON.stringify(response.result, null, 2), "Read the prepayment and invoice/bill back from Xero to verify the allocation."].join("\n") }] };
  },
);

export default AllocatePrepaymentTool;

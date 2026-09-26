import { z } from "zod";
import { deleteXeroOverpaymentAllocation } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteOverpaymentAllocationTool = CreateXeroTool(
  "delete-overpayment-allocation",
  "Delete a Xero overpayment allocation by OverpaymentID and AllocationID. Read the overpayment and invoice/bill back after deletion.",
  {
    overpaymentId: z.string(),
    allocationId: z.string(),
  },
  async ({ overpaymentId, allocationId }) => {
    const response = await deleteXeroOverpaymentAllocation(overpaymentId, allocationId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error deleting overpayment allocation: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: ["Overpayment allocation deletion requested successfully.", JSON.stringify(response.result, null, 2), "Read the overpayment and invoice/bill back from Xero to verify the reversal."].join("\n") }] };
  },
);

export default DeleteOverpaymentAllocationTool;

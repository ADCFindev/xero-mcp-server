import { z } from "zod";
import { deleteXeroPrepaymentAllocation } from "../../handlers/xero-prepayments-overpayments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeletePrepaymentAllocationTool = CreateXeroTool(
  "delete-prepayment-allocation",
  "Delete a Xero prepayment allocation by PrepaymentID and AllocationID. Read the prepayment and invoice/bill back after deletion.",
  {
    prepaymentId: z.string(),
    allocationId: z.string(),
  },
  async ({ prepaymentId, allocationId }) => {
    const response = await deleteXeroPrepaymentAllocation(prepaymentId, allocationId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error deleting prepayment allocation: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: ["Prepayment allocation deleted successfully.", JSON.stringify(response.result, null, 2), "Read the prepayment and invoice/bill back from Xero to verify the reversal."].join("\n") }] };
  },
);

export default DeletePrepaymentAllocationTool;

import { z } from "zod";

import { createXeroBatchPayment } from "../../handlers/xero-batch-payments-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateBatchPaymentTool = CreateXeroTool(
  "create-batch-payment",
  "Create one Xero batch payment that allocates a single bank-account payment across multiple approved invoices or bills. Use the same bank account and batch date for all allocations. Verify the returned batch and affected invoices after creation.",
  {
    accountId: z
      .string()
      .describe("The Xero bank Account ID used for the batch payment."),
    date: z
      .string()
      .describe("Batch payment date in YYYY-MM-DD format."),
    reference: z
      .string()
      .min(1)
      .describe("Reference for the batch payment, such as the bank statement reference."),
    payments: z
      .array(
        z.object({
          invoiceId: z
            .string()
            .describe("Xero Invoice ID for the invoice or bill being paid."),
          amount: z
            .number()
            .positive()
            .describe("Amount allocated to this invoice or bill."),
        }),
      )
      .min(1)
      .describe("Invoice or bill allocations included in the batch payment."),
  },
  async ({ accountId, date, reference, payments }) => {
    const response = await createXeroBatchPayment({
      accountId,
      date,
      reference,
      payments,
    });

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating batch payment: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Batch payment created successfully.",
            JSON.stringify(response.result, null, 2),
            "Read the batch payment and affected invoices back from Xero to verify the write.",
          ].join("\n"),
        },
      ],
    };
  },
);

export default CreateBatchPaymentTool;

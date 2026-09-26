import { z } from "zod";
import { createXeroCreditNote } from "../../handlers/create-xero-credit-note.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitAmount: z.number(),
  accountCode: z.string(),
  taxType: z.string(),
});

const CreateCreditNoteTool = CreateXeroTool(
  "create-credit-note",
  "Create a credit note in Xero. Type and status are optional; existing behaviour defaults to a DRAFT customer credit note. Use AUTHORISED only when the user explicitly wants a posted credit note. Read the credit note back after creation.",
  {
    contactId: z.string(),
    lineItems: z.array(lineItemSchema),
    reference: z.string().optional(),
    type: z
      .enum(["ACCRECCREDIT", "ACCPAYCREDIT"])
      .default("ACCRECCREDIT")
      .describe("Customer credit note (ACCRECCREDIT) or supplier credit note (ACCPAYCREDIT)."),
    status: z
      .enum(["DRAFT", "AUTHORISED"])
      .default("DRAFT")
      .describe("Create as DRAFT or AUTHORISED."),
    date: z
      .string()
      .optional()
      .describe("Optional credit note date in YYYY-MM-DD format. Defaults to today."),
  },
  async ({ contactId, lineItems, reference, type, status, date }) => {
    const result = await createXeroCreditNote(
      contactId,
      lineItems,
      reference,
      type,
      status,
      date,
    );

    if (result.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating credit note: ${result.error}`,
          },
        ],
      };
    }

    const creditNote = result.result;

    const deepLink = creditNote.creditNoteID
      ? await getDeepLink(DeepLinkType.CREDIT_NOTE, creditNote.creditNoteID)
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Credit note created successfully:",
            `ID: ${creditNote?.creditNoteID}`,
            `Number: ${creditNote?.creditNoteNumber}`,
            `Type: ${creditNote?.type}`,
            `Contact: ${creditNote?.contact?.name}`,
            `Total: ${creditNote?.total}`,
            `Status: ${creditNote?.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
            "Read the credit note back from Xero before treating the write as confirmed.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateCreditNoteTool;

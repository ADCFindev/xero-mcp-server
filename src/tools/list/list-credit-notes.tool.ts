import { z } from "zod";
import { listXeroCreditNotes } from "../../handlers/list-xero-credit-notes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatAmount, formatXeroDate } from "../../helpers/format-xero-output.js";

const ListCreditNotesTool = CreateXeroTool(
  "list-credit-notes",
  "List credit notes in Xero. Can optionally filter by contact.",
  {
    page: z.number(),
    contactId: z.string().optional(),
  },
  async ({ page, contactId }) => {
    const response = await listXeroCreditNotes(page, contactId);
    if (response.error !== null) {
      return { content: [{ type: "text" as const, text: `Error listing credit notes: ${response.error}` }] };
    }

    const creditNotes = response.result ?? [];
    if (creditNotes.length === 0) {
      return { content: [{ type: "text" as const, text: "Found 0 credit notes." }] };
    }

    const header = `Found ${creditNotes.length} ${creditNotes.length === 1 ? "credit note" : "credit notes"}.`;
    const records = creditNotes.map((creditNote) =>
      [
        `Credit Note ID: ${creditNote.creditNoteID || "(none)"}`,
        `Credit Note Number: ${creditNote.creditNoteNumber || "(none)"}`,
        creditNote.reference ? `Reference: ${creditNote.reference}` : null,
        `Type: ${creditNote.type || "Unknown"}`,
        `Status: ${creditNote.status || "Unknown"}`,
        creditNote.contact
          ? `Contact: ${creditNote.contact.name || "(unnamed)"} (${creditNote.contact.contactID || "Unknown ID"})`
          : null,
        creditNote.date ? `Date: ${formatXeroDate(creditNote.date)}` : null,
        creditNote.lineAmountTypes ? `Line Amount Types: ${creditNote.lineAmountTypes}` : null,
        creditNote.subTotal !== undefined ? `Sub Total: ${formatAmount(creditNote.subTotal)}` : null,
        creditNote.totalTax !== undefined ? `Total Tax: ${formatAmount(creditNote.totalTax)}` : null,
        `Total: ${formatAmount(creditNote.total)}`,
        creditNote.remainingCredit !== undefined ? `Remaining Credit: ${formatAmount(creditNote.remainingCredit)}` : null,
        creditNote.currencyCode ? `Currency: ${creditNote.currencyCode}` : null,
        creditNote.currencyRate !== undefined ? `Currency Rate: ${creditNote.currencyRate}` : null,
        creditNote.updatedDateUTC ? `Last Updated: ${formatXeroDate(creditNote.updatedDateUTC)}` : null,
      ].filter(Boolean).join("\n"),
    );

    return {
      content: [{
        type: "text" as const,
        text: [header, ...records.map((record) => `---\n${record}`)].join("\n\n"),
      }],
    };
  },
);

export default ListCreditNotesTool;

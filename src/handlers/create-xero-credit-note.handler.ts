import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { CreditNote } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

interface CreditNoteLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType: string;
}

type CreditNoteType = "ACCRECCREDIT" | "ACCPAYCREDIT";
type CreditNoteStatus = "DRAFT" | "AUTHORISED";

async function createCreditNote(
  contactId: string,
  lineItems: CreditNoteLineItem[],
  reference: string | undefined,
  type: CreditNoteType,
  status: CreditNoteStatus,
  date?: string,
): Promise<CreditNote | undefined> {
  await xeroClient.authenticate();

  const creditNote: CreditNote = {
    type:
      type === "ACCPAYCREDIT"
        ? CreditNote.TypeEnum.ACCPAYCREDIT
        : CreditNote.TypeEnum.ACCRECCREDIT,
    contact: {
      contactID: contactId,
    },
    lineItems,
    date: date || new Date().toISOString().split("T")[0],
    reference,
    status:
      status === "AUTHORISED"
        ? CreditNote.StatusEnum.AUTHORISED
        : CreditNote.StatusEnum.DRAFT,
  };

  const response = await xeroClient.accountingApi.createCreditNotes(
    xeroClient.tenantId,
    {
      creditNotes: [creditNote],
    },
    true,
    undefined,
    undefined,
    getClientHeaders(),
  );

  return response.body.creditNotes?.[0];
}

export async function createXeroCreditNote(
  contactId: string,
  lineItems: CreditNoteLineItem[],
  reference?: string,
  type: CreditNoteType = "ACCRECCREDIT",
  status: CreditNoteStatus = "DRAFT",
  date?: string,
): Promise<XeroClientResponse<CreditNote>> {
  try {
    const createdCreditNote = await createCreditNote(
      contactId,
      lineItems,
      reference,
      type,
      status,
      date,
    );

    if (!createdCreditNote) {
      throw new Error("Credit note creation failed.");
    }

    if (createdCreditNote.validationErrors?.length) {
      throw new Error(
        createdCreditNote.validationErrors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" "),
      );
    }

    return {
      result: createdCreditNote,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}

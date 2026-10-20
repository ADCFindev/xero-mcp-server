import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Invoice, LineItemTracking } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { InvoiceOptions, invoiceOptionFields } from "./create-xero-invoice.handler.js";

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType: string;
  itemCode?: string;
  tracking?: LineItemTracking[];
}

async function getInvoice(invoiceId: string): Promise<Invoice | undefined> {
  await xeroClient.authenticate();

  // First, get the current invoice to check its status
  const response = await xeroClient.accountingApi.getInvoice(
    xeroClient.tenantId,
    invoiceId, // invoiceId
    undefined, // unitdp
    getClientHeaders(), // options
  );

  return response.body.invoices?.[0];
}

async function updateInvoice(
  invoiceId: string,
  lineItems?: InvoiceLineItem[],
  reference?: string,
  dueDate?: string,
  date?: string,
  contactId?: string,
  options: InvoiceOptions = {},
): Promise<Invoice | undefined> {
  const invoice: Invoice = {
    lineItems: lineItems,
    reference: reference,
    dueDate: dueDate,
    date: date,
    contact: contactId ? { contactID: contactId } : undefined,
    ...invoiceOptionFields(options),
  };

  const response = await xeroClient.accountingApi.updateInvoice(
    xeroClient.tenantId,
    invoiceId, // invoiceId
    {
      invoices: [invoice],
    }, // invoices
    undefined, // unitdp
    undefined, // idempotencyKey
    getClientHeaders(), // options
  );

  return response.body.invoices?.[0];
}

/**
 * Xero lets the API edit DRAFT, SUBMITTED and AUTHORISED invoices and bills,
 * but not once a payment, credit note, prepayment or overpayment is applied,
 * and never PAID, VOIDED or DELETED ones. Returns why an edit is refused, or
 * null when Xero should be asked to make it.
 */
export function editRefusal(invoice: Invoice | undefined): string | null {
  const status = invoice?.status;

  switch (status) {
    case Invoice.StatusEnum.DRAFT:
    case Invoice.StatusEnum.SUBMITTED:
      return null;
    case Invoice.StatusEnum.AUTHORISED: {
      const paid = Number(invoice?.amountPaid ?? 0);
      const credited = Number(invoice?.amountCredited ?? 0);
      if (paid !== 0 || credited !== 0) {
        return `Cannot update invoice because it has payments (${paid}) or credits (${credited}) applied. \
Xero only allows edits once these are removed.`;
      }
      return null;
    }
    case Invoice.StatusEnum.PAID:
      return "Cannot update invoice because it is PAID. Xero does not allow paid invoices to be edited; \
remove the payments first, or void it and create a replacement.";
    default:
      return `Cannot update invoice with status ${status}.`;
  }
}

/**
 * Update an existing invoice in Xero
 */
export async function updateXeroInvoice(
  invoiceId: string,
  lineItems?: InvoiceLineItem[],
  reference?: string,
  dueDate?: string,
  date?: string,
  contactId?: string,
  options: InvoiceOptions = {},
): Promise<XeroClientResponse<Invoice>> {
  try {
    const existingInvoice = await getInvoice(invoiceId);

    const refusal = editRefusal(existingInvoice);
    if (refusal) {
      return {
        result: null,
        isError: true,
        error: refusal,
      };
    }

    const updatedInvoice = await updateInvoice(
      invoiceId,
      lineItems,
      reference,
      dueDate,
      date,
      contactId,
      options,
    );

    if (!updatedInvoice) {
      throw new Error("Invoice update failed.");
    }

    return {
      result: updatedInvoice,
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

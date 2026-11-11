import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { Invoice } from "xero-node";

interface XeroValidationErrorBody {
  Elements?: Array<{
    ValidationErrors?: Array<{ Message?: string }>;
  }>;
}

/**
 * Pull Xero's ValidationErrors out of an SDK error body, so the caller sees
 * the reason Xero gives rather than "A validation exception occurred".
 */
function extractValidationMessages(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const body = (error as { response?: { body?: unknown } }).response?.body;
  if (typeof body !== "object" || body === null) return [];

  const messages: string[] = [];
  for (const element of (body as XeroValidationErrorBody).Elements ?? []) {
    for (const validationError of element.ValidationErrors ?? []) {
      if (validationError.Message) messages.push(validationError.Message);
    }
  }
  return messages;
}

const VOIDABLE_STATUSES: Invoice.StatusEnum[] = [
  Invoice.StatusEnum.SUBMITTED,
  Invoice.StatusEnum.AUTHORISED,
];

async function getInvoice(invoiceId: string): Promise<Invoice | undefined> {
  const response = await xeroClient.accountingApi.getInvoice(
    xeroClient.tenantId, // xeroTenantId
    invoiceId, // invoiceID
    undefined, // unitdp
    getClientHeaders(), // options
  );

  return response.body.invoices?.[0];
}

async function voidInvoice(invoiceId: string): Promise<Invoice | undefined> {
  // Only the ID and the new status are sent, so nothing else on the
  // invoice (line items, dates, contact) can be changed by this call.
  const invoice: Invoice = {
    invoiceID: invoiceId,
    status: Invoice.StatusEnum.VOIDED,
  };

  const response = await xeroClient.accountingApi.updateInvoice(
    xeroClient.tenantId, // xeroTenantId
    invoiceId, // invoiceID
    { invoices: [invoice] }, // invoices
    undefined, // unitdp
    undefined, // idempotencyKey
    getClientHeaders(), // options
  );

  return response.body.invoices?.[0];
}

/**
 * Void an approved or awaiting-approval invoice or bill in Xero. Xero only
 * allows this while nothing has been paid or credited against it; drafts
 * cannot be voided (Xero deletes them instead).
 */
export async function voidXeroInvoice(
  invoiceId: string,
): Promise<XeroClientResponse<Invoice>> {
  try {
    await xeroClient.authenticate();

    const existing = await getInvoice(invoiceId);

    if (!existing) {
      throw new Error("Could not find invoice");
    }

    if (existing.status === Invoice.StatusEnum.VOIDED) {
      throw new Error("Invoice is already voided");
    }

    if (!existing.status || !VOIDABLE_STATUSES.includes(existing.status)) {
      throw new Error(
        `Invoice status is ${existing.status ?? "unknown"}. Only approved (AUTHORISED) or awaiting-approval (SUBMITTED) invoices can be voided.`,
      );
    }

    if ((existing.amountPaid ?? 0) !== 0 || (existing.amountCredited ?? 0) !== 0) {
      throw new Error(
        `Invoice has payments or credits applied (paid ${existing.amountPaid ?? 0}, credited ${existing.amountCredited ?? 0}). Remove them in Xero before voiding.`,
      );
    }

    const voided = await voidInvoice(invoiceId);

    if (!voided) {
      throw new Error("Failed to void invoice");
    }

    const validationMessages = (voided.validationErrors ?? [])
      .map((validationError) => validationError.message)
      .filter((message): message is string => Boolean(message));

    if (validationMessages.length > 0) {
      throw new Error(validationMessages.join(" "));
    }

    if (voided.status !== Invoice.StatusEnum.VOIDED) {
      throw new Error(
        `Xero did not confirm the void; status is ${voided.status ?? "unknown"}`,
      );
    }

    return { result: voided, isError: false, error: null };
  } catch (error) {
    const validationMessages = extractValidationMessages(error);

    return {
      result: null,
      isError: true,
      error:
        validationMessages.length > 0
          ? validationMessages.join(" ")
          : formatError(error),
    };
  }
}

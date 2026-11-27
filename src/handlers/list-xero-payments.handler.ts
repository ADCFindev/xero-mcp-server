import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Payment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { DEFAULT_PAGE_SIZE, dateConditions, statusCondition } from "../helpers/list-filters.js";

export interface PaymentListFilters {
  invoiceNumber?: string;
  invoiceId?: string;
  paymentId?: string;
  reference?: string;
  statuses?: string[];
  fromDate?: string;
  toDate?: string;
  pageSize?: number;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A value put between quotes in the where expression: a quote or a backslash in it would change the expression.
function quoted(name: string, value: string): string {
  if (/["\\]/.test(value)) throw new Error(`${name} must not contain a double quote or a backslash`);
  return `"${value}"`;
}
function guid(name: string, value: string): string {
  if (!GUID.test(value)) throw new Error(`${name} must be an ID (GUID), got "${value}"`);
  return `guid("${value}")`;
}

export function paymentsWhere({ invoiceNumber, invoiceId, paymentId, reference, statuses, fromDate, toDate }: PaymentListFilters): string | undefined {
  const conditions = [
    invoiceId ? `Invoice.InvoiceID==${guid("invoiceId", invoiceId)}` : null,
    invoiceNumber ? `Invoice.InvoiceNumber==${quoted("invoiceNumber", invoiceNumber)}` : null,
    paymentId ? `PaymentID==${guid("paymentId", paymentId)}` : null,
    reference ? `Reference==${quoted("reference", reference)}` : null,
    statusCondition(statuses),
    ...dateConditions("Date", fromDate, toDate),
  ].filter((c): c is string => c !== null);
  return conditions.length > 0 ? conditions.join(" AND ") : undefined;
}

async function getPayments(page: number, filters: PaymentListFilters): Promise<Payment[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getPayments(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    paymentsWhere(filters),
    "UpdatedDateUTC DESC", // order
    page, // page
    filters.pageSize ?? DEFAULT_PAGE_SIZE, // pageSize
    getClientHeaders(), // options
  );

  return response.body.payments ?? [];
}

/**
 * List payments from Xero
 */
export async function listXeroPayments(
  page: number = 1,
  filters: PaymentListFilters = {},
): Promise<XeroClientResponse<Payment[]>> {
  try {
    const payments = await getPayments(page, filters);

    return {
      result: payments,
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

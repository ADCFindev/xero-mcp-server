import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { DEFAULT_PAGE_SIZE, dateConditions } from "../helpers/list-filters.js";

export interface InvoiceListFilters {
  statuses?: string[];
  fromDate?: string;
  toDate?: string;
  pageSize?: number;
}

async function getInvoices(
  invoiceNumbers: string[] | undefined,
  contactIds: string[] | undefined,
  page: number,
  { statuses, fromDate, toDate, pageSize }: InvoiceListFilters,
): Promise<Invoice[]> {
  await xeroClient.authenticate();

  const where = dateConditions("Date", fromDate, toDate).join(" AND ");
  const invoices = await xeroClient.accountingApi.getInvoices(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    where || undefined, // where
    "UpdatedDateUTC DESC", // order
    undefined, // iDs
    invoiceNumbers, // invoiceNumbers
    contactIds, // contactIDs
    statuses?.length ? statuses : undefined, // statuses
    page,
    false, // includeArchived
    false, // createdByMyApp
    undefined, // unitdp
    false, // summaryOnly
    pageSize ?? DEFAULT_PAGE_SIZE, // pageSize
    undefined, // searchTerm
    getClientHeaders(),
  );
  return invoices.body.invoices ?? [];
}

/**
 * List invoices from Xero, optionally only some statuses, a date range and a larger page.
 */
export async function listXeroInvoices(
  page: number = 1,
  contactIds?: string[],
  invoiceNumbers?: string[],
  filters: InvoiceListFilters = {},
): Promise<XeroClientResponse<Invoice[]>> {
  try {
    const invoices = await getInvoices(invoiceNumbers, contactIds, page, filters);

    return {
      result: invoices,
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

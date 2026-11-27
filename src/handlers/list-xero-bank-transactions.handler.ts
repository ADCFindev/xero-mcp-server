import { xeroClient } from "../clients/xero-client.js";
import { BankTransaction } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { DEFAULT_PAGE_SIZE, dateConditions, statusCondition } from "../helpers/list-filters.js";

export interface BankTransactionListFilters {
  statuses?: string[];
  fromDate?: string;
  toDate?: string;
  pageSize?: number;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getBankTransactions(
  page: number,
  bankAccountId: string | undefined,
  { statuses, fromDate, toDate, pageSize }: BankTransactionListFilters,
): Promise<BankTransaction[]> {
  await xeroClient.authenticate();

  if (bankAccountId && !GUID.test(bankAccountId)) {
    throw new Error(`bankAccountId must be an account ID (GUID), got "${bankAccountId}"`);
  }
  const conditions = [
    bankAccountId ? `BankAccount.AccountID=guid("${bankAccountId}")` : null,
    statusCondition(statuses),
    ...dateConditions("Date", fromDate, toDate),
  ].filter((c): c is string => c !== null);

  const response = await xeroClient.accountingApi.getBankTransactions(xeroClient.tenantId,
      undefined, // ifModifiedSince
      conditions.length ? conditions.join(" AND ") : undefined, // where
      "Date DESC", // order
      page, // page
      undefined, // unitdp
      pageSize ?? DEFAULT_PAGE_SIZE, // pagesize
      getClientHeaders()
  );

  return response.body.bankTransactions ?? [];
}

export async function listXeroBankTransactions(
  page: number = 1,
  bankAccountId?: string,
  filters: BankTransactionListFilters = {},
): Promise<XeroClientResponse<BankTransaction[]>> {
  try {
    const bankTransactions = await getBankTransactions(page, bankAccountId, filters);

    return {
      result: bankTransactions,
      isError: false,
      error: null
    }
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error)
    }
  }
}

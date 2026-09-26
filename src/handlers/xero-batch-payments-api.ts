import axios from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

export type BatchPaymentAllocation = {
  invoiceId: string;
  amount: number;
};

export type XeroBatchPayment = {
  Account?: {
    AccountID?: string;
    Code?: string;
    Name?: string;
    CurrencyCode?: string;
  };
  Reference?: string;
  BatchPaymentID?: string;
  DateString?: string;
  Date?: string;
  Payments?: Array<{
    Invoice?: {
      InvoiceID?: string;
      InvoiceNumber?: string;
      CurrencyCode?: string;
    };
    PaymentID?: string;
    Reference?: string;
    Amount?: number;
    BankAmount?: number;
  }>;
  Type?: string;
  Status?: string;
  TotalAmount?: number;
  UpdatedDateUTC?: string;
  IsReconciled?: boolean;
  ValidationErrors?: Array<{ Message?: string }>;
};

type BatchPaymentsEnvelope = {
  BatchPayments?: XeroBatchPayment[];
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  await xeroClient.authenticate();

  const tokenSet = xeroClient.readTokenSet();
  const accessToken = tokenSet.access_token;

  if (!accessToken) {
    throw new Error("Xero access token is unavailable.");
  }

  if (!xeroClient.tenantId) {
    throw new Error("Xero tenant ID is unavailable.");
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroClient.tenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export async function listXeroBatchPayments(
  where?: string,
  order?: string,
): Promise<XeroClientResponse<XeroBatchPayment[]>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.get<BatchPaymentsEnvelope>(
      "https://api.xero.com/api.xro/2.0/BatchPayments",
      {
        headers,
        params: {
          ...(where ? { where } : {}),
          ...(order ? { order } : {}),
        },
      },
    );

    return {
      result: response.data.BatchPayments ?? [],
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

export async function createXeroBatchPayment(params: {
  accountId: string;
  date: string;
  reference: string;
  payments: BatchPaymentAllocation[];
}): Promise<XeroClientResponse<XeroBatchPayment[]>> {
  try {
    const headers = await getAuthHeaders();

    const body = {
      BatchPayments: [
        {
          Account: {
            AccountID: params.accountId,
          },
          Reference: params.reference,
          Date: params.date,
          Payments: params.payments.map((payment) => ({
            Invoice: {
              InvoiceID: payment.invoiceId,
            },
            Amount: payment.amount,
          })),
        },
      ],
    };

    const response = await axios.put<BatchPaymentsEnvelope>(
      "https://api.xero.com/api.xro/2.0/BatchPayments",
      body,
      {
        headers,
        params: {
          summarizeErrors: false,
        },
      },
    );

    return {
      result: response.data.BatchPayments ?? [],
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

export async function deleteXeroBatchPayment(
  batchPaymentId: string,
): Promise<XeroClientResponse<XeroBatchPayment[]>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.post<BatchPaymentsEnvelope>(
      `https://api.xero.com/api.xro/2.0/BatchPayments/${encodeURIComponent(batchPaymentId)}`,
      {
        Status: "DELETED",
      },
      {
        headers,
      },
    );

    return {
      result: response.data.BatchPayments ?? [],
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

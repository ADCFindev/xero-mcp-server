import axios from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

export type XeroBankTransfer = {
  BankTransferID?: string;
  FromBankAccount?: {
    AccountID?: string;
    Code?: string;
    Name?: string;
    CurrencyCode?: string;
  };
  ToBankAccount?: {
    AccountID?: string;
    Code?: string;
    Name?: string;
    CurrencyCode?: string;
  };
  Amount?: number;
  Date?: string;
  DateString?: string;
  CurrencyRate?: number;
  FromBankTransactionID?: string;
  ToBankTransactionID?: string;
  FromIsReconciled?: boolean;
  ToIsReconciled?: boolean;
  Reference?: string;
  Status?: string;
  CreatedDateUTC?: string;
  CreatedDateUTCString?: string;
  ValidationErrors?: Array<{ Message?: string }>;
  StatusAttributeString?: string;
};

type BankTransfersEnvelope = {
  Status?: string;
  StatusAttributeString?: string;
  BankTransfers?: XeroBankTransfer[];
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

function extractValidationErrors(
  envelope: BankTransfersEnvelope,
): string[] {
  const messages: string[] = [];

  if (envelope.StatusAttributeString === "ERROR") {
    messages.push("Xero returned StatusAttributeString=ERROR.");
  }

  for (const transfer of envelope.BankTransfers ?? []) {
    if (transfer.StatusAttributeString === "ERROR") {
      messages.push("Bank transfer returned StatusAttributeString=ERROR.");
    }

    for (const validationError of transfer.ValidationErrors ?? []) {
      if (validationError.Message) {
        messages.push(validationError.Message);
      }
    }
  }

  return messages;
}

export async function listXeroBankTransfers(params?: {
  where?: string;
  order?: string;
  includeDeleted?: boolean;
}): Promise<XeroClientResponse<XeroBankTransfer[]>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.get<BankTransfersEnvelope>(
      "https://api.xero.com/api.xro/2.0/BankTransfers",
      {
        headers,
        params: {
          ...(params?.where ? { where: params.where } : {}),
          ...(params?.order ? { order: params.order } : {}),
          ...(params?.includeDeleted !== undefined
            ? { includeDeleted: params.includeDeleted }
            : {}),
        },
      },
    );

    return {
      result: response.data.BankTransfers ?? [],
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

export async function getXeroBankTransfer(
  bankTransferId: string,
): Promise<XeroClientResponse<XeroBankTransfer | null>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.get<BankTransfersEnvelope>(
      `https://api.xero.com/api.xro/2.0/BankTransfers/${encodeURIComponent(bankTransferId)}`,
      { headers },
    );

    return {
      result: response.data.BankTransfers?.[0] ?? null,
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

export async function createXeroBankTransfer(params: {
  fromBankAccountId: string;
  toBankAccountId: string;
  amount: number;
  date?: string;
  reference?: string;
  fromIsReconciled?: boolean;
  toIsReconciled?: boolean;
}): Promise<XeroClientResponse<XeroBankTransfer[]>> {
  try {
    if (params.fromBankAccountId === params.toBankAccountId) {
      throw new Error("From and To bank accounts must be different.");
    }

    const headers = await getAuthHeaders();

    const transfer = {
      FromBankAccount: {
        AccountID: params.fromBankAccountId,
      },
      ToBankAccount: {
        AccountID: params.toBankAccountId,
      },
      Amount: params.amount,
      ...(params.date ? { Date: params.date } : {}),
      ...(params.reference ? { Reference: params.reference } : {}),
      ...(params.fromIsReconciled !== undefined
        ? { FromIsReconciled: params.fromIsReconciled }
        : {}),
      ...(params.toIsReconciled !== undefined
        ? { ToIsReconciled: params.toIsReconciled }
        : {}),
    };

    const response = await axios.put<BankTransfersEnvelope>(
      "https://api.xero.com/api.xro/2.0/BankTransfers",
      {
        BankTransfers: [transfer],
      },
      { headers },
    );

    const validationErrors = extractValidationErrors(response.data);
    const transfers = response.data.BankTransfers ?? [];

    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join(" "));
    }

    if (transfers.length === 0 || !transfers.some((item) => item.BankTransferID)) {
      throw new Error(
        "Xero did not return a BankTransferID. The bank transfer was not confirmed as created.",
      );
    }

    return {
      result: transfers,
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

export async function deleteXeroBankTransfer(
  bankTransferId: string,
): Promise<XeroClientResponse<XeroBankTransfer[]>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.post<BankTransfersEnvelope>(
      `https://api.xero.com/api.xro/2.0/BankTransfers/${encodeURIComponent(bankTransferId)}`,
      {
        Status: "DELETED",
      },
      { headers },
    );

    const validationErrors = extractValidationErrors(response.data);

    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join(" "));
    }

    return {
      result: response.data.BankTransfers ?? [],
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

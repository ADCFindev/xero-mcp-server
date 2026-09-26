import axios from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

export type XeroCreditNoteAllocation = {
  AllocationID?: string;
  Invoice?: {
    InvoiceID?: string;
    InvoiceNumber?: string;
    Type?: string;
    Contact?: {
      ContactID?: string;
      Name?: string;
    };
  };
  Amount?: number;
  Date?: string;
  IsDeleted?: boolean;
  StatusAttributeString?: string;
  ValidationErrors?: Array<{ Message?: string }>;
};

export type XeroCreditNote = {
  CreditNoteID?: string;
  CreditNoteNumber?: string;
  Type?: string;
  Status?: string;
  Contact?: {
    ContactID?: string;
    Name?: string;
  };
  Date?: string;
  Reference?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  RemainingCredit?: number;
  FullyPaidOnDate?: string;
  Allocations?: XeroCreditNoteAllocation[];
  Payments?: unknown[];
  HasAttachments?: boolean;
  UpdatedDateUTC?: string;
  UpdatedDateUTCString?: string;
};

type CreditNotesEnvelope = {
  CreditNotes?: XeroCreditNote[];
};

type AllocationsEnvelope = {
  Allocations?: XeroCreditNoteAllocation[];
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

function normalizeAllocation(
  allocation: XeroCreditNoteAllocation,
): XeroCreditNoteAllocation {
  const normalized = { ...allocation };

  if (
    normalized.Date === "/Date(-62135596800000)/" ||
    normalized.Date === "0001-01-01" ||
    normalized.Date === "0001-01-01T00:00:00"
  ) {
    delete normalized.Date;
  }

  return normalized;
}

function allocationErrors(
  allocation?: XeroCreditNoteAllocation,
): string[] {
  if (!allocation) {
    return [];
  }

  const messages: string[] = [];

  if (allocation.StatusAttributeString === "ERROR") {
    messages.push("Xero returned StatusAttributeString=ERROR.");
  }

  for (const error of allocation.ValidationErrors ?? []) {
    if (error.Message) {
      messages.push(error.Message);
    }
  }

  return messages;
}

function parseAllocationResponse(
  data: unknown,
): XeroCreditNoteAllocation | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;

  if (Array.isArray(record.Allocations)) {
    const allocation =
      (record.Allocations[0] as XeroCreditNoteAllocation | undefined) ?? null;

    return allocation ? normalizeAllocation(allocation) : null;
  }

  return normalizeAllocation(data as XeroCreditNoteAllocation);
}

export async function getXeroCreditNote(
  creditNoteId: string,
): Promise<XeroClientResponse<XeroCreditNote | null>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.get<CreditNotesEnvelope>(
      `https://api.xero.com/api.xro/2.0/CreditNotes/${encodeURIComponent(creditNoteId)}`,
      { headers },
    );

    return {
      result: response.data.CreditNotes?.[0] ?? null,
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

export async function allocateXeroCreditNote(params: {
  creditNoteId: string;
  invoiceId: string;
  amount: number;
}): Promise<XeroClientResponse<XeroCreditNoteAllocation>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.put<
      AllocationsEnvelope | XeroCreditNoteAllocation
    >(
      `https://api.xero.com/api.xro/2.0/CreditNotes/${encodeURIComponent(params.creditNoteId)}/Allocations`,
      {
        Amount: params.amount,
        Invoice: {
          InvoiceID: params.invoiceId,
        },
      },
      { headers },
    );

    const allocation = parseAllocationResponse(response.data);

    if (!allocation) {
      throw new Error("Xero did not return an allocation.");
    }

    const errors = allocationErrors(allocation);

    if (errors.length > 0) {
      throw new Error(errors.join(" "));
    }

    if (!allocation.AllocationID) {
      throw new Error(
        "Xero did not return an AllocationID. The credit note allocation was not confirmed.",
      );
    }

    return {
      result: allocation,
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

export async function deleteXeroCreditNoteAllocation(
  creditNoteId: string,
  allocationId: string,
): Promise<XeroClientResponse<XeroCreditNoteAllocation>> {
  try {
    const headers = await getAuthHeaders();

    const response = await axios.delete<XeroCreditNoteAllocation>(
      `https://api.xero.com/api.xro/2.0/CreditNotes/${encodeURIComponent(creditNoteId)}/Allocations/${encodeURIComponent(allocationId)}`,
      { headers },
    );

    const allocation = parseAllocationResponse(response.data);

    if (!allocation) {
      throw new Error("Xero did not return the deleted allocation.");
    }

    const errors = allocationErrors(allocation);

    if (errors.length > 0) {
      throw new Error(errors.join(" "));
    }

    return {
      result: allocation,
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

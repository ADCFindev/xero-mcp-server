import axios from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";

export type XeroAllocation = {
  AllocationID?: string;
  Invoice?: {
    InvoiceID?: string;
    InvoiceNumber?: string;
    Type?: string;
    Contact?: { ContactID?: string; Name?: string };
  };
  Amount?: number;
  Date?: string;
  IsDeleted?: boolean;
  StatusAttributeString?: string;
  ValidationErrors?: Array<{ Message?: string }>;
};

export type XeroPrepayment = {
  Type?: string;
  Contact?: { ContactID?: string; Name?: string };
  Date?: string;
  Status?: string;
  LineAmountTypes?: string;
  LineItems?: unknown[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  Reference?: string;
  InvoiceNumber?: string;
  CurrencyCode?: string;
  PrepaymentID?: string;
  CurrencyRate?: number;
  RemainingCredit?: number;
  Allocations?: XeroAllocation[];
  Payments?: unknown[];
  AppliedAmount?: number;
  HasAttachments?: boolean;
  UpdatedDateUTC?: string;
  UpdatedDateUTCString?: string;
};

export type XeroOverpayment = {
  Type?: string;
  Contact?: { ContactID?: string; Name?: string };
  Date?: string;
  Status?: string;
  LineAmountTypes?: string;
  LineItems?: unknown[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  Reference?: string;
  CurrencyCode?: string;
  OverpaymentID?: string;
  CurrencyRate?: number;
  RemainingCredit?: number;
  Allocations?: XeroAllocation[];
  Payments?: unknown[];
  AppliedAmount?: number;
  HasAttachments?: boolean;
  UpdatedDateUTC?: string;
  UpdatedDateUTCString?: string;
};

type PrepaymentsEnvelope = { Prepayments?: XeroPrepayment[] };
type OverpaymentsEnvelope = { Overpayments?: XeroOverpayment[] };
type AllocationsEnvelope = { Allocations?: XeroAllocation[] };

async function getAuthHeaders(): Promise<Record<string, string>> {
  await xeroClient.authenticate();
  const tokenSet = xeroClient.readTokenSet();
  const accessToken = tokenSet.access_token;

  if (!accessToken) throw new Error("Xero access token is unavailable.");
  if (!xeroClient.tenantId) throw new Error("Xero tenant ID is unavailable.");

  return {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroClient.tenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function enrichPrepayment(prepayment: XeroPrepayment): XeroPrepayment {
  if (
    prepayment.AppliedAmount === undefined &&
    typeof prepayment.Total === "number" &&
    typeof prepayment.RemainingCredit === "number"
  ) {
    return {
      ...prepayment,
      AppliedAmount: prepayment.Total - prepayment.RemainingCredit,
    };
  }

  return prepayment;
}

function enrichOverpayment(overpayment: XeroOverpayment): XeroOverpayment {
  if (
    overpayment.AppliedAmount === undefined &&
    typeof overpayment.Total === "number" &&
    typeof overpayment.RemainingCredit === "number"
  ) {
    return {
      ...overpayment,
      AppliedAmount: overpayment.Total - overpayment.RemainingCredit,
    };
  }

  return overpayment;
}

function allocationErrors(allocation?: XeroAllocation): string[] {
  if (!allocation) return [];
  const messages: string[] = [];

  if (allocation.StatusAttributeString === "ERROR") {
    messages.push("Xero returned StatusAttributeString=ERROR.");
  }

  for (const error of allocation.ValidationErrors ?? []) {
    if (error.Message) messages.push(error.Message);
  }

  return messages;
}

function normalizeAllocation(allocation: XeroAllocation): XeroAllocation {
  const normalized = { ...allocation };

  // Xero can return its zero/default .NET date in create-allocation responses.
  // It is not a meaningful accounting date, so omit it and rely on read-back.
  if (
    normalized.Date === "/Date(-62135596800000)/" ||
    normalized.Date === "0001-01-01" ||
    normalized.Date === "0001-01-01T00:00:00"
  ) {
    delete normalized.Date;
  }

  return normalized;
}

function parseAllocationResponse(data: unknown): XeroAllocation | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.Allocations)) {
    const allocation =
      (record.Allocations[0] as XeroAllocation | undefined) ?? null;
    return allocation ? normalizeAllocation(allocation) : null;
  }

  return normalizeAllocation(data as XeroAllocation);
}

export async function listXeroPrepayments(params?: {
  where?: string;
  order?: string;
  page?: number;
}): Promise<XeroClientResponse<XeroPrepayment[]>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get<PrepaymentsEnvelope>(
      "https://api.xero.com/api.xro/2.0/Prepayments",
      {
        headers,
        params: {
          ...(params?.where ? { where: params.where } : {}),
          ...(params?.order ? { order: params.order } : {}),
          ...(params?.page ? { page: params.page } : {}),
        },
      },
    );

    return { result: (response.data.Prepayments ?? []).map(enrichPrepayment), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function getXeroPrepayment(
  prepaymentId: string,
): Promise<XeroClientResponse<XeroPrepayment | null>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get<PrepaymentsEnvelope>(
      `https://api.xero.com/api.xro/2.0/Prepayments/${encodeURIComponent(prepaymentId)}`,
      { headers },
    );

    return {
      result: response.data.Prepayments?.[0] ? enrichPrepayment(response.data.Prepayments[0]) : null,
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function allocateXeroPrepayment(params: {
  prepaymentId: string;
  invoiceId: string;
  amount: number;
}): Promise<XeroClientResponse<XeroAllocation>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.put<AllocationsEnvelope | XeroAllocation>(
      `https://api.xero.com/api.xro/2.0/Prepayments/${encodeURIComponent(params.prepaymentId)}/Allocations`,
      { Amount: params.amount, Invoice: { InvoiceID: params.invoiceId } },
      { headers },
    );

    const allocation = parseAllocationResponse(response.data);
    if (!allocation) throw new Error("Xero did not return an allocation.");

    const errors = allocationErrors(allocation);
    if (errors.length > 0) throw new Error(errors.join(" "));

    if (!allocation.AllocationID) {
      throw new Error("Xero did not return an AllocationID. The prepayment allocation was not confirmed.");
    }

    return { result: allocation, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function deleteXeroPrepaymentAllocation(
  prepaymentId: string,
  allocationId: string,
): Promise<XeroClientResponse<XeroAllocation>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.delete<XeroAllocation>(
      `https://api.xero.com/api.xro/2.0/Prepayments/${encodeURIComponent(prepaymentId)}/Allocations/${encodeURIComponent(allocationId)}`,
      { headers },
    );

    const allocation = parseAllocationResponse(response.data);
    if (!allocation) throw new Error("Xero did not return the deleted allocation.");

    const errors = allocationErrors(allocation);
    if (errors.length > 0) throw new Error(errors.join(" "));

    return { result: allocation, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function listXeroOverpayments(params?: {
  where?: string;
  order?: string;
  page?: number;
}): Promise<XeroClientResponse<XeroOverpayment[]>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get<OverpaymentsEnvelope>(
      "https://api.xero.com/api.xro/2.0/Overpayments",
      {
        headers,
        params: {
          ...(params?.where ? { where: params.where } : {}),
          ...(params?.order ? { order: params.order } : {}),
          ...(params?.page ? { page: params.page } : {}),
        },
      },
    );

    return { result: (response.data.Overpayments ?? []).map(enrichOverpayment), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function getXeroOverpayment(
  overpaymentId: string,
): Promise<XeroClientResponse<XeroOverpayment | null>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get<OverpaymentsEnvelope>(
      `https://api.xero.com/api.xro/2.0/Overpayments/${encodeURIComponent(overpaymentId)}`,
      { headers },
    );

    return {
      result: response.data.Overpayments?.[0] ? enrichOverpayment(response.data.Overpayments[0]) : null,
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function allocateXeroOverpayment(params: {
  overpaymentId: string;
  invoiceId: string;
  amount: number;
}): Promise<XeroClientResponse<XeroAllocation>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.put<AllocationsEnvelope | XeroAllocation>(
      `https://api.xero.com/api.xro/2.0/Overpayments/${encodeURIComponent(params.overpaymentId)}/Allocations`,
      { Amount: params.amount, Invoice: { InvoiceID: params.invoiceId } },
      { headers },
    );

    const allocation = parseAllocationResponse(response.data);
    if (!allocation) throw new Error("Xero did not return an allocation.");

    const errors = allocationErrors(allocation);
    if (errors.length > 0) throw new Error(errors.join(" "));

    if (!allocation.AllocationID) {
      throw new Error("Xero did not return an AllocationID. The overpayment allocation was not confirmed.");
    }

    return { result: allocation, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function deleteXeroOverpaymentAllocation(
  overpaymentId: string,
  allocationId: string,
): Promise<XeroClientResponse<XeroAllocation>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.delete<XeroAllocation>(
      `https://api.xero.com/api.xro/2.0/Overpayments/${encodeURIComponent(overpaymentId)}/Allocations/${encodeURIComponent(allocationId)}`,
      { headers },
    );

    const allocation = parseAllocationResponse(response.data);
    if (!allocation) throw new Error("Xero did not return the deleted allocation.");

    const errors = allocationErrors(allocation);
    if (errors.length > 0) throw new Error(errors.join(" "));

    return { result: allocation, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

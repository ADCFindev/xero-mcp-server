import axios from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { normalizeXeroOutput } from "../helpers/format-xero-output.js";
import { XeroClientResponse } from "../types/tool-response.js";

export type SupportedDocumentResource =
  | "Invoices"
  | "CreditNotes"
  | "BankTransactions";

type AttachmentRecord = {
  AttachmentID?: string;
  FileName?: string;
  Url?: string;
  MimeType?: string;
  ContentLength?: number;
  IncludeOnline?: boolean;
};

type HistoryRecord = {
  DateUTC?: string;
  DateUTCString?: string;
  Changes?: string;
  User?: string;
  Details?: string;
};

async function getAuthHeaders(contentType?: string): Promise<Record<string, string>> {
  await xeroClient.authenticate();

  const tokenSet = xeroClient.readTokenSet();
  const accessToken = tokenSet.access_token;

  if (!accessToken) throw new Error("Xero access token is unavailable.");
  if (!xeroClient.tenantId) throw new Error("Xero tenant ID is unavailable.");

  return {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroClient.tenantId,
    Accept: "application/json",
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function collectionFrom<T>(
  data: unknown,
  key: string,
): T[] {
  if (!data || typeof data !== "object") return [];
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function listXeroAttachments(
  resource: SupportedDocumentResource,
  resourceId: string,
): Promise<XeroClientResponse<AttachmentRecord[]>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get(
      `https://api.xero.com/api.xro/2.0/${resource}/${encodeURIComponent(resourceId)}/Attachments`,
      { headers },
    );

    return {
      result: normalizeXeroOutput(
        collectionFrom<AttachmentRecord>(response.data, "Attachments"),
      ) as AttachmentRecord[],
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function uploadXeroAttachment(params: {
  resource: SupportedDocumentResource;
  resourceId: string;
  fileName: string;
  contentBase64: string;
  contentType?: string;
}): Promise<XeroClientResponse<{
  uploaded: AttachmentRecord[];
  verified: boolean;
  attachmentsAfterUpload: AttachmentRecord[];
}>> {
  try {
    const headers = await getAuthHeaders(
      params.contentType || "application/octet-stream",
    );
    const body = Buffer.from(params.contentBase64, "base64");

    if (body.length === 0) {
      throw new Error("Attachment content is empty after base64 decoding.");
    }

    const response = await axios.put(
      `https://api.xero.com/api.xro/2.0/${params.resource}/${encodeURIComponent(params.resourceId)}/Attachments/${encodeURIComponent(params.fileName)}`,
      body,
      { headers },
    );

    const uploaded = collectionFrom<AttachmentRecord>(
      response.data,
      "Attachments",
    );

    const readBack = await listXeroAttachments(
      params.resource,
      params.resourceId,
    );

    if (readBack.isError) {
      throw new Error(
        `Attachment upload returned successfully, but read-back failed: ${readBack.error}`,
      );
    }

    const attachmentsAfterUpload = readBack.result ?? [];
    const verified = attachmentsAfterUpload.some(
      (attachment) => attachment.FileName === params.fileName,
    );

    if (!verified) {
      throw new Error(
        "Attachment upload could not be verified by filename on read-back.",
      );
    }

    return {
      result: {
        uploaded: normalizeXeroOutput(uploaded) as AttachmentRecord[],
        verified,
        attachmentsAfterUpload,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function getXeroHistory(
  resource: SupportedDocumentResource,
  resourceId: string,
): Promise<XeroClientResponse<HistoryRecord[]>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get(
      `https://api.xero.com/api.xro/2.0/${resource}/${encodeURIComponent(resourceId)}/History`,
      { headers },
    );

    return {
      result: normalizeXeroOutput(
        collectionFrom<HistoryRecord>(response.data, "HistoryRecords"),
      ) as HistoryRecord[],
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

export async function addXeroHistoryNote(params: {
  resource: SupportedDocumentResource;
  resourceId: string;
  details: string;
}): Promise<XeroClientResponse<{
  created: HistoryRecord[];
  historyAfterWrite: HistoryRecord[];
}>> {
  try {
    const headers = await getAuthHeaders("application/json");

    const response = await axios.put(
      `https://api.xero.com/api.xro/2.0/${params.resource}/${encodeURIComponent(params.resourceId)}/History`,
      {
        HistoryRecords: [{ Details: params.details }],
      },
      { headers },
    );

    const created = collectionFrom<HistoryRecord>(
      response.data,
      "HistoryRecords",
    );

    const readBack = await getXeroHistory(params.resource, params.resourceId);
    if (readBack.isError) {
      throw new Error(
        `History note write returned successfully, but read-back failed: ${readBack.error}`,
      );
    }

    const historyAfterWrite = readBack.result ?? [];
    const verified = historyAfterWrite.some(
      (record) => record.Details === params.details,
    );

    if (!verified) {
      throw new Error(
        "History note could not be verified by exact Details text on read-back.",
      );
    }

    return {
      result: {
        created: normalizeXeroOutput(created) as HistoryRecord[],
        historyAfterWrite,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

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

export const MAX_ATTACHMENT_DOWNLOAD_BYTES = 10 * 1024 * 1024;

function describeAttachments(attachments: AttachmentRecord[]): string {
  return attachments
    .map((attachment) => `${attachment.FileName} (${attachment.AttachmentID})`)
    .join(", ");
}

export async function getXeroAttachment(params: {
  resource: SupportedDocumentResource;
  resourceId: string;
  attachmentId?: string;
  fileName?: string;
}): Promise<XeroClientResponse<{
  attachment: AttachmentRecord;
  contentBase64: string;
  sizeBytes: number;
}>> {
  try {
    const listed = await listXeroAttachments(params.resource, params.resourceId);
    if (listed.isError) throw new Error(listed.error);

    const attachments = listed.result ?? [];
    if (attachments.length === 0) {
      throw new Error("This document has no attachments.");
    }

    let attachment: AttachmentRecord | undefined;
    if (params.attachmentId) {
      attachment = attachments.find(
        (candidate) => candidate.AttachmentID === params.attachmentId,
      );
    } else if (params.fileName) {
      attachment = attachments.find(
        (candidate) => candidate.FileName === params.fileName,
      );
    } else if (attachments.length === 1) {
      attachment = attachments[0];
    } else {
      throw new Error(
        `This document has ${attachments.length} attachments; pass attachmentId or fileName. Available: ${describeAttachments(attachments)}`,
      );
    }

    if (!attachment?.AttachmentID) {
      throw new Error(
        `Attachment not found. Available: ${describeAttachments(attachments)}`,
      );
    }

    if (
      attachment.ContentLength &&
      attachment.ContentLength > MAX_ATTACHMENT_DOWNLOAD_BYTES
    ) {
      throw new Error(
        `Attachment is ${attachment.ContentLength} bytes, over the ${MAX_ATTACHMENT_DOWNLOAD_BYTES}-byte download limit.`,
      );
    }

    const headers = await getAuthHeaders();
    headers.Accept = attachment.MimeType || "application/octet-stream";

    const response = await axios.get(
      `https://api.xero.com/api.xro/2.0/${params.resource}/${encodeURIComponent(params.resourceId)}/Attachments/${encodeURIComponent(attachment.AttachmentID)}`,
      {
        headers,
        responseType: "arraybuffer",
        maxContentLength: MAX_ATTACHMENT_DOWNLOAD_BYTES,
      },
    );

    const body = Buffer.from(response.data as ArrayBuffer);
    if (body.length === 0) {
      throw new Error("Xero returned an empty attachment.");
    }

    return {
      result: {
        attachment,
        contentBase64: body.toString("base64"),
        sizeBytes: body.length,
      },
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

    let historyAfterWrite: HistoryRecord[] = [];
    let verified = false;
    let lastReadError: string | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const readBack = await getXeroHistory(params.resource, params.resourceId);

      if (readBack.isError) {
        lastReadError = readBack.error;
        continue;
      }

      historyAfterWrite = readBack.result ?? [];
      verified = historyAfterWrite.some(
        (record) => record.Details === params.details,
      );

      if (verified) break;
    }

    if (!verified) {
      throw new Error(
        lastReadError
          ? `History note write returned successfully, but read-back failed after retries: ${lastReadError}`
          : "History note could not be verified by exact Details text after 3 read-back attempts.",
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

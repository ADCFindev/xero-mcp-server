import axios from "axios";
import { createHash } from "node:crypto";

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

export type CopiedAttachment = {
  copied: boolean;
  alreadyAttached: boolean;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  source: AttachmentRecord;
  attachmentsOnTarget: AttachmentRecord[];
};

// Copies one attachment from a document to another, on the server: the file never passes through the caller.
// Idempotent: a file with the same name and size already on the target is reported as attached, not uploaded again.
// A different file under the same name is refused (Xero would silently replace or duplicate it).
export async function copyXeroAttachment(params: {
  fromResource: SupportedDocumentResource;
  fromResourceId: string;
  toResource: SupportedDocumentResource;
  toResourceId: string;
  attachmentId?: string;
  fileName?: string;
  toFileName?: string;
}): Promise<XeroClientResponse<CopiedAttachment>> {
  try {
    if (
      params.fromResource === params.toResource &&
      params.fromResourceId === params.toResourceId &&
      !params.toFileName
    ) {
      throw new Error("Source and target are the same document; give toFileName to copy under another name.");
    }

    const downloaded = await getXeroAttachment({
      resource: params.fromResource,
      resourceId: params.fromResourceId,
      attachmentId: params.attachmentId,
      fileName: params.fileName,
    });
    if (downloaded.isError) throw new Error(downloaded.error);

    const { attachment, contentBase64, sizeBytes } = downloaded.result;
    const fileName = params.toFileName ?? attachment.FileName;
    if (!fileName) throw new Error("The source attachment has no file name; give toFileName.");
    const mimeType = attachment.MimeType || "application/octet-stream";

    const existing = await listXeroAttachments(params.toResource, params.toResourceId);
    if (existing.isError) throw new Error(existing.error);
    const same = (existing.result ?? []).find((candidate) => candidate.FileName === fileName);
    if (same) {
      if (same.ContentLength === sizeBytes) {
        return {
          result: { copied: false, alreadyAttached: true, fileName, mimeType, sizeBytes, source: attachment, attachmentsOnTarget: existing.result ?? [] },
          isError: false,
          error: null,
        };
      }
      throw new Error(
        `The target already has a different file named ${fileName} (${same.ContentLength ?? "unknown"} bytes, source ${sizeBytes}); nothing was uploaded.`,
      );
    }

    const uploaded = await uploadXeroAttachment({
      resource: params.toResource,
      resourceId: params.toResourceId,
      fileName,
      contentBase64,
      contentType: mimeType,
    });
    if (uploaded.isError) throw new Error(uploaded.error);

    const onTarget = uploaded.result.attachmentsAfterUpload;
    const landed = onTarget.find((candidate) => candidate.FileName === fileName);
    if (landed?.ContentLength !== undefined && landed.ContentLength !== sizeBytes) {
      throw new Error(`Uploaded, but the size on the target (${landed.ContentLength}) differs from the source (${sizeBytes}); check the target in Xero.`);
    }

    return {
      result: { copied: true, alreadyAttached: false, fileName, mimeType, sizeBytes, source: attachment, attachmentsOnTarget: onTarget },
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

export type AttachedFromUrl = {
  attached: boolean;
  alreadyAttached: boolean;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  attachmentsOnTarget: AttachmentRecord[];
};

function allowedSourceHosts(): string[] {
  return (process.env.ATTACHMENT_SOURCE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

// Attaches a file that the SERVER downloads from a one-time https link (e.g. a Drive download link from our Google
// Workspace connector), so the bytes never pass through the caller. Only hosts listed in ATTACHMENT_SOURCE_HOSTS are
// fetched, no redirects, at most 10 MB. The received bytes are checked against the sender's size/SHA-256 when given, and
// the upload is read back and its size compared. Idempotent: same name and size already on the target = nothing sent.
export async function attachXeroAttachmentFromUrl(params: {
  resource: SupportedDocumentResource;
  resourceId: string;
  sourceUrl: string;
  fileName?: string;
  expectedSizeBytes?: number;
  expectedSha256?: string;
}): Promise<XeroClientResponse<AttachedFromUrl>> {
  try {
    const source = new URL(params.sourceUrl);
    const hosts = allowedSourceHosts();
    if (source.protocol !== "https:" || !hosts.includes(source.hostname.toLowerCase())) {
      throw new Error(
        `The source host ${source.hostname} is not allowed; set ATTACHMENT_SOURCE_HOSTS on the server (https only).`,
      );
    }

    const response = await axios.get(params.sourceUrl, {
      responseType: "arraybuffer",
      maxRedirects: 0,
      maxContentLength: MAX_ATTACHMENT_DOWNLOAD_BYTES,
      validateStatus: (status: number) => status === 200,
    });
    const bytes = Buffer.from(response.data);
    if (bytes.length === 0) throw new Error("The source returned an empty file.");

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const headerSha = String(response.headers?.["x-sha256"] ?? "").toLowerCase();
    const wantedSha = (params.expectedSha256 ?? headerSha).toLowerCase();
    if (wantedSha && wantedSha !== sha256) {
      throw new Error(`The downloaded file's SHA-256 (${sha256}) differs from the expected one (${wantedSha}); nothing was uploaded.`);
    }
    if (params.expectedSizeBytes !== undefined && params.expectedSizeBytes !== bytes.length) {
      throw new Error(`The downloaded file is ${bytes.length} bytes, expected ${params.expectedSizeBytes}; nothing was uploaded.`);
    }

    const headerName = response.headers?.["x-file-name"] ? decodeURIComponent(String(response.headers["x-file-name"])) : undefined;
    const fileName = params.fileName ?? headerName;
    if (!fileName) throw new Error("No file name: the source sent none and fileName was not given.");
    const mimeType = String(response.headers?.["content-type"] ?? "application/octet-stream").split(";")[0];

    const existing = await listXeroAttachments(params.resource, params.resourceId);
    if (existing.isError) throw new Error(existing.error);
    const same = (existing.result ?? []).find((candidate) => candidate.FileName === fileName);
    if (same) {
      if (same.ContentLength === bytes.length) {
        return {
          result: { attached: false, alreadyAttached: true, fileName, mimeType, sizeBytes: bytes.length, sha256, attachmentsOnTarget: existing.result ?? [] },
          isError: false,
          error: null,
        };
      }
      throw new Error(
        `The document already has a different file named ${fileName} (${same.ContentLength ?? "unknown"} bytes, new ${bytes.length}); nothing was uploaded.`,
      );
    }

    const uploaded = await uploadXeroAttachment({
      resource: params.resource,
      resourceId: params.resourceId,
      fileName,
      contentBase64: bytes.toString("base64"),
      contentType: mimeType,
    });
    if (uploaded.isError) throw new Error(uploaded.error);

    const onTarget = uploaded.result.attachmentsAfterUpload;
    const landed = onTarget.find((candidate) => candidate.FileName === fileName);
    if (landed?.ContentLength !== undefined && landed.ContentLength !== bytes.length) {
      throw new Error(`Uploaded, but the size in Xero (${landed.ContentLength}) differs from the file (${bytes.length}); check the document in Xero.`);
    }

    return {
      result: { attached: true, alreadyAttached: false, fileName, mimeType, sizeBytes: bytes.length, sha256, attachmentsOnTarget: onTarget },
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

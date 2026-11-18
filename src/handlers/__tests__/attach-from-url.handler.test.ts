import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("axios", () => ({ default: http, AxiosError: class AxiosError extends Error {} }));
vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn(),
    readTokenSet: () => ({ access_token: "token" }),
    tenantId: "tenant-id",
  },
}));

import { attachXeroAttachmentFromUrl } from "../xero-document-extras-api.js";

const DOC = "target-bill";
const PDF = Buffer.from("%PDF-1.4 synthetic invoice");
const SHA = createHash("sha256").update(PDF).digest("hex");
const URL_OK = "https://files.example.test/download/token123";

// One fake Xero (attachment listing that grows on upload) and one fake source link.
function fake(listing: Array<Record<string, unknown>>, source: { bytes?: Buffer; sha?: string } = {}) {
  http.get.mockImplementation(async (url: string) => {
    if (url === URL_OK) {
      return {
        data: source.bytes ?? PDF,
        headers: { "content-type": "application/pdf", "x-file-name": "bill%20one.pdf", "x-sha256": source.sha ?? SHA },
      };
    }
    if (url.endsWith("/Attachments")) return { data: { Attachments: listing } };
    throw new Error(`unexpected GET ${url}`);
  });
  http.put.mockImplementation(async (url: string, body: Buffer) => {
    listing.push({ AttachmentID: "att-new", FileName: decodeURIComponent(url.split("/").pop() ?? ""), MimeType: "application/pdf", ContentLength: body.length });
    return { data: { Attachments: [listing.at(-1)] } };
  });
}

const params = { resource: "Invoices", resourceId: DOC, sourceUrl: URL_OK } as const;

describe("attachXeroAttachmentFromUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ATTACHMENT_SOURCE_HOSTS = "files.example.test";
  });

  it("downloads on the server, uploads under the source's file name and verifies the size", async () => {
    fake([]);
    const response = await attachXeroAttachmentFromUrl(params);
    expect(response.isError).toBe(false);
    expect(response.result).toMatchObject({ attached: true, fileName: "bill one.pdf", sizeBytes: PDF.length, sha256: SHA });
    const [url, body] = http.put.mock.calls[0];
    expect(url).toContain(`/Invoices/${DOC}/Attachments/bill%20one.pdf`);
    expect(Buffer.from(body).equals(PDF)).toBe(true);
    expect(http.get.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
  });

  it("refuses hosts that are not listed and plain http, without fetching", async () => {
    fake([]);
    for (const sourceUrl of ["https://evil.example.test/x", "http://files.example.test/x"]) {
      const response = await attachXeroAttachmentFromUrl({ ...params, sourceUrl });
      expect(response.isError).toBe(true);
    }
    process.env.ATTACHMENT_SOURCE_HOSTS = "";
    expect((await attachXeroAttachmentFromUrl(params)).isError).toBe(true);
    expect(http.get).not.toHaveBeenCalled();
    expect(http.put).not.toHaveBeenCalled();
  });

  it("uploads nothing when the SHA-256 or the size does not match", async () => {
    fake([], { sha: "0".repeat(64) });
    expect((await attachXeroAttachmentFromUrl(params)).error).toMatch(/SHA-256/);
    fake([]);
    expect((await attachXeroAttachmentFromUrl({ ...params, expectedSizeBytes: PDF.length + 1 })).error).toMatch(/expected/);
    expect(http.put).not.toHaveBeenCalled();
  });

  it("does not upload again when the same file is already attached, and refuses a different file under that name", async () => {
    fake([{ FileName: "bill one.pdf", ContentLength: PDF.length }]);
    const again = await attachXeroAttachmentFromUrl(params);
    expect(again.result).toMatchObject({ attached: false, alreadyAttached: true });
    fake([{ FileName: "bill one.pdf", ContentLength: PDF.length + 5 }]);
    expect((await attachXeroAttachmentFromUrl(params)).error).toMatch(/different file/);
    expect(http.put).not.toHaveBeenCalled();
  });
});

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

import { copyXeroAttachment } from "../xero-document-extras-api.js";

const FROM = "source-bill";
const TO = "target-bill";
const PDF = Buffer.from("%PDF-1.4 synthetic invoice");
const SOURCE_FILE = { AttachmentID: "att-1", FileName: "invoice.pdf", MimeType: "application/pdf", ContentLength: PDF.length };

type Listing = Record<string, Array<Record<string, unknown>>>;

// One fake Xero: attachment listings per document (they change as the upload lands) and the file's bytes.
function fakeXero(listings: Listing) {
  http.get.mockImplementation(async (url: string, options?: { responseType?: string }) => {
    const document = url.includes(`/${FROM}/`) ? FROM : TO;
    if (url.endsWith("/Attachments")) return { data: { Attachments: listings[document] } };
    if (options?.responseType === "arraybuffer") return { data: PDF };
    throw new Error(`unexpected GET ${url}`);
  });
  http.put.mockImplementation(async (url: string) => {
    listings[TO] = [...listings[TO], { AttachmentID: "att-new", FileName: decodeURIComponent(url.split("/").pop() ?? ""), MimeType: "application/pdf", ContentLength: PDF.length }];
    return { data: { Attachments: [listings[TO].at(-1)] } };
  });
}

const params = { fromResource: "Invoices", fromResourceId: FROM, toResource: "Invoices", toResourceId: TO } as const;

describe("copyXeroAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads from the source, uploads to the target and verifies the size", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE], [TO]: [] });

    const response = await copyXeroAttachment(params);

    expect(response.isError).toBe(false);
    expect(response.result).toMatchObject({ copied: true, alreadyAttached: false, fileName: "invoice.pdf", sizeBytes: PDF.length });
    const [url, body, options] = http.put.mock.calls[0];
    expect(url).toContain(`/Invoices/${TO}/Attachments/invoice.pdf`);
    expect(Buffer.from(body).equals(PDF)).toBe(true);
    expect(options.headers["Content-Type"]).toBe("application/pdf");
    expect(http.put).toHaveBeenCalledTimes(1);
  });

  it("does not upload again when the same file is already on the target", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE], [TO]: [{ ...SOURCE_FILE, AttachmentID: "att-existing" }] });

    const response = await copyXeroAttachment(params);

    expect(response.isError).toBe(false);
    expect(response.result).toMatchObject({ copied: false, alreadyAttached: true });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("refuses a different file with the same name on the target", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE], [TO]: [{ ...SOURCE_FILE, ContentLength: 5 }] });

    const response = await copyXeroAttachment(params);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/different file named invoice\.pdf/);
    expect(http.put).not.toHaveBeenCalled();
  });

  it("needs a choice when the source has several attachments, and nothing is uploaded", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE, { ...SOURCE_FILE, AttachmentID: "att-2", FileName: "other.pdf" }], [TO]: [] });

    const response = await copyXeroAttachment(params);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/2 attachments/);
    expect(http.put).not.toHaveBeenCalled();
  });

  it("copies the named file under another name", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE, { ...SOURCE_FILE, AttachmentID: "att-2", FileName: "other.pdf" }], [TO]: [] });

    const response = await copyXeroAttachment({ ...params, fileName: "invoice.pdf", toFileName: "official-invoice.pdf" });

    expect(response.isError).toBe(false);
    expect(response.result?.fileName).toBe("official-invoice.pdf");
    expect(http.put.mock.calls[0][0]).toContain("/Attachments/official-invoice.pdf");
  });

  it("refuses to copy a document onto itself without a new name", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE], [TO]: [] });

    const response = await copyXeroAttachment({ ...params, toResourceId: FROM });

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/same document/);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("reports a size mismatch read back from the target", async () => {
    fakeXero({ [FROM]: [SOURCE_FILE], [TO]: [] });
    http.put.mockImplementation(async (url: string) => {
      const landed = { AttachmentID: "att-new", FileName: decodeURIComponent(url.split("/").pop() ?? ""), MimeType: "application/pdf", ContentLength: 3 };
      http.get.mockImplementation(async (u: string, o?: { responseType?: string }) => {
        if (u.endsWith("/Attachments")) return { data: { Attachments: u.includes(`/${FROM}/`) ? [SOURCE_FILE] : [landed] } };
        if (o?.responseType === "arraybuffer") return { data: PDF };
        throw new Error("unexpected");
      });
      return { data: { Attachments: [landed] } };
    });

    const response = await copyXeroAttachment(params);

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/size on the target \(3\) differs/);
  });
});

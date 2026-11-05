import { beforeEach, describe, expect, it, vi } from "vitest";

import { withXeroMcpAuthorization } from "../../clients/xero-client.js";
import {
  cachedReference,
  clearReferenceCache,
  invalidateReference,
  REFERENCE_TTL_MS,
} from "../reference-cache.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const asTenant = <T>(tenantId: string, operation: () => Promise<T>) =>
  withXeroMcpAuthorization({ accessToken: "token", tenantId }, operation, async () => [
    { tenantId: TENANT_A },
    { tenantId: TENANT_B },
  ]);

describe("reference cache", () => {
  beforeEach(() => clearReferenceCache());

  it("reuses a result for the same organisation and arguments", async () => {
    const loader = vi.fn(async () => ["4000 Sales"]);
    const first = await asTenant(TENANT_A, () => cachedReference("accounts", null, loader));
    const second = await asTenant(TENANT_A, () => cachedReference("accounts", null, loader));
    expect(first).toEqual(["4000 Sales"]);
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps organisations and arguments apart", async () => {
    const loader = vi.fn(async () => "x");
    await asTenant(TENANT_A, () => cachedReference("contacts", { page: 1 }, loader));
    await asTenant(TENANT_B, () => cachedReference("contacts", { page: 1 }, loader));
    await asTenant(TENANT_A, () => cachedReference("contacts", { page: 2 }, loader));
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("expires entries after the kind's time limit", async () => {
    let now = 1_000;
    const loader = vi.fn(async () => "rates");
    const read = () =>
      asTenant(TENANT_A, () => cachedReference("taxRates", null, loader, { now: () => now }));
    await read();
    now += REFERENCE_TTL_MS.taxRates - 1;
    await read();
    expect(loader).toHaveBeenCalledTimes(1);
    now += 2;
    await read();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("fetches again on refresh and after a write clears the kind", async () => {
    const loader = vi.fn(async () => "categories");
    const read = (refresh?: boolean) =>
      asTenant(TENANT_A, () =>
        cachedReference("trackingCategories", null, loader, { refresh }),
      );
    await read();
    await read(true);
    expect(loader).toHaveBeenCalledTimes(2);
    await read();
    expect(loader).toHaveBeenCalledTimes(2);
    await asTenant(TENANT_A, async () => invalidateReference("trackingCategories"));
    await read();
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("clears only the organisation that changed", async () => {
    const loader = vi.fn(async () => "contacts");
    await asTenant(TENANT_A, () => cachedReference("contacts", null, loader));
    await asTenant(TENANT_B, () => cachedReference("contacts", null, loader));
    await asTenant(TENANT_A, async () => invalidateReference("contacts"));
    await asTenant(TENANT_B, () => cachedReference("contacts", null, loader));
    expect(loader).toHaveBeenCalledTimes(2);
    await asTenant(TENANT_A, () => cachedReference("contacts", null, loader));
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("does not cache errors", async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce("ok");
    await expect(
      asTenant(TENANT_A, () => cachedReference("items", { page: 1 }, loader)),
    ).rejects.toThrow("rate limited");
    await expect(
      asTenant(TENANT_A, () => cachedReference("items", { page: 1 }, loader)),
    ).resolves.toBe("ok");
  });

  it("shares one Xero call between concurrent reads", async () => {
    const loader = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("org"), 5)),
    );
    await asTenant(TENANT_A, () =>
      Promise.all([
        cachedReference("organisation", null, loader),
        cachedReference("organisation", null, loader),
      ]),
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not keep a result that a write made stale while it loaded", async () => {
    let release: (value: string) => void = () => {};
    const slow = () => new Promise<string>((resolve) => (release = resolve));
    const fresh = vi.fn(async () => "after");
    await asTenant(TENANT_A, async () => {
      const pending = cachedReference("contacts", null, slow);
      invalidateReference("contacts");
      release("before");
      await expect(pending).resolves.toBe("before");
      await expect(cachedReference("contacts", null, fresh)).resolves.toBe("after");
    });
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});

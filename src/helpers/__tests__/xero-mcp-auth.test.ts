import { describe, expect, it } from "vitest";

import { parseXeroMcpAuthorization } from "../xero-mcp-auth.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("parseXeroMcpAuthorization", () => {
  it("extracts a bearer token and exactly one selected tenant", () => {
    expect(
      parseXeroMcpAuthorization(`Bearer short-lived-token`, TENANT_ID),
    ).toEqual({
      accessToken: "short-lived-token",
      tenantId: TENANT_ID,
    });
  });

  it.each([
    [undefined, TENANT_ID],
    ["Basic short-lived-token", TENANT_ID],
    ["Bearer token with whitespace", TENANT_ID],
    ["Bearer short-lived-token", undefined],
    ["Bearer short-lived-token", [TENANT_ID, TENANT_ID]],
    ["Bearer short-lived-token", "not-a-tenant-id"],
  ])("rejects missing or malformed authorization headers", (authorization, tenant) => {
    expect(parseXeroMcpAuthorization(authorization, tenant)).toBeNull();
  });
});
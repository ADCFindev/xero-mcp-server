import { describe, expect, it } from "vitest";

import {
  withXeroMcpAuthorization,
  XeroMcpAuthorizationError,
  XeroMcpAuthorizationUnavailableError,
  xeroClient,
} from "../xero-client.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("request-scoped Xero authorization", () => {
  it("keeps concurrent access tokens and explicitly selected tenants isolated", async () => {
    const tokensChecked: string[] = [];
    const connectionsLoader = async (accessToken: string) => {
      tokensChecked.push(accessToken);
      return accessToken.endsWith("-a")
        ? [{ tenantId: TENANT_B }, { tenantId: TENANT_A }]
        : [{ tenantId: TENANT_A }, { tenantId: TENANT_B }];
    };

    const readContext = async (accessToken: string, tenantId: string) =>
      withXeroMcpAuthorization(
        { accessToken, tenantId },
        async () => {
          await xeroClient.authenticate();
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {
            tenantId: xeroClient.tenantId,
            accessToken: xeroClient.readTokenSet()?.access_token,
          };
        },
        connectionsLoader,
      );

    const [resultA, resultB] = await Promise.all([
      readContext("short-lived-token-a", TENANT_A),
      readContext("short-lived-token-b", TENANT_B),
    ]);

    expect(resultA).toEqual({
      tenantId: TENANT_A,
      accessToken: "short-lived-token-a",
    });
    expect(resultB).toEqual({
      tenantId: TENANT_B,
      accessToken: "short-lived-token-b",
    });
    expect(tokensChecked.sort()).toEqual([
      "short-lived-token-a",
      "short-lived-token-b",
    ]);
  });

  it("rejects tenants that are not connected to the supplied access token", async () => {
    let operationCalled = false;

    await expect(
      withXeroMcpAuthorization(
        { accessToken: "short-lived-token", tenantId: TENANT_B },
        () => {
          operationCalled = true;
        },
        async () => [{ tenantId: TENANT_A }],
      ),
    ).rejects.toBeInstanceOf(XeroMcpAuthorizationError);

    expect(operationCalled).toBe(false);
  });

  it("rejects malformed authorization before contacting Xero", async () => {
    let loaderCalled = false;

    await expect(
      withXeroMcpAuthorization(
        { accessToken: "token with whitespace", tenantId: TENANT_A },
        () => undefined,
        async () => {
          loaderCalled = true;
          return [{ tenantId: TENANT_A }];
        },
      ),
    ).rejects.toBeInstanceOf(XeroMcpAuthorizationError);

    expect(loaderCalled).toBe(false);
  });

  it("returns sanitized authorization and availability failures", async () => {
    const rejectedToken = Object.assign(
      new Error("Bearer secret-token"),
      { response: { status: 401 } },
    );
    await expect(
      withXeroMcpAuthorization(
        { accessToken: "short-lived-token", tenantId: TENANT_A },
        () => undefined,
        async () => {
          throw rejectedToken;
        },
      ),
    ).rejects.toMatchObject({
      name: "XeroMcpAuthorizationError",
      message: expect.not.stringContaining("secret-token"),
    });

    await expect(
      withXeroMcpAuthorization(
        { accessToken: "short-lived-token", tenantId: TENANT_A },
        () => undefined,
        async () => {
          throw new Error("upstream connection detail");
        },
      ),
    ).rejects.toMatchObject({
      name: "XeroMcpAuthorizationUnavailableError",
      message: expect.not.stringContaining("upstream connection detail"),
    });
    expect(XeroMcpAuthorizationUnavailableError).toBeDefined();
  });
});
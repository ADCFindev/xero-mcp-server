import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  authenticateServiceClient,
  authorizeServiceBody,
  loadServiceClients,
} from "../service-clients.js";

const KEY = "k".repeat(40);
const DEMO = "d6f86544-7ec9-4cdc-b34d-a54ec1387ffe";
const REAL = "0411102b-51af-4914-8d77-9e0a3fb61b39";
const entry = {
  id: "workflows",
  keySha256: createHash("sha256").update(KEY).digest("hex"),
  grantEmail: "owner@example.test",
  allowedTenantIds: [DEMO],
  allowedTools: ["list-accounts", "create-payment"],
};
const clients = loadServiceClients(JSON.stringify([entry]));
const call = (name: string, organisation?: string) => ({
  jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: organisation ? { organisation } : {} },
});

describe("service clients", () => {
  it("authenticates only the exact key, and rejects short or wrong keys", () => {
    expect(authenticateServiceClient(clients, KEY)?.id).toBe("workflows");
    expect(authenticateServiceClient(clients, "x".repeat(40))).toBeUndefined();
    expect(authenticateServiceClient(clients, "short")).toBeUndefined();
    expect(authenticateServiceClient(clients, undefined)).toBeUndefined();
  });

  it("allows an allowed tool on an explicitly allowed tenant ID", () => {
    expect(authorizeServiceBody(clients[0]!, call("list-accounts", DEMO)).ok).toBe(true);
    expect(authorizeServiceBody(clients[0]!, call("list-accounts", DEMO.toUpperCase())).ok).toBe(true);
  });

  it("refuses a real-client tenant, a tenant name, a missing tenant (no default) and unlisted tools", () => {
    for (const bad of [
      call("list-accounts", REAL),
      call("list-accounts", "Demo Company (Global)"),
      call("list-accounts"),
      call("delete-payment", DEMO),
      call("list-organisations", DEMO),
    ]) {
      expect(authorizeServiceBody(clients[0]!, bad).ok).toBe(false);
    }
  });

  it("checks every message of a batch and refuses unknown methods", () => {
    expect(authorizeServiceBody(clients[0]!, [call("list-accounts", DEMO), call("list-accounts", REAL)]).ok).toBe(false);
    expect(authorizeServiceBody(clients[0]!, { jsonrpc: "2.0", id: 2, method: "resources/read" }).ok).toBe(false);
    expect(authorizeServiceBody(clients[0]!, []).ok).toBe(false);
    expect(authorizeServiceBody(clients[0]!, { jsonrpc: "2.0", id: 3, method: "tools/list" }).ok).toBe(true);
  });

  it("rejects malformed configuration", () => {
    expect(() => loadServiceClients("{}")).toThrow();
    expect(() => loadServiceClients(JSON.stringify([{ ...entry, allowedTenantIds: ["Demo Company"] }]))).toThrow();
    expect(() => loadServiceClients(JSON.stringify([{ ...entry, keySha256: "abc" }]))).toThrow();
    expect(loadServiceClients(undefined)).toEqual([]);
  });
});

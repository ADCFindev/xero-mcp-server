import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Service clients: machine callers (e.g. the ADC Xero Workflows engine) that use an EXISTING Xero OAuth grant held by
 * this server, without ever receiving a Xero token.
 *
 * Configured with SERVICE_CLIENTS, a JSON array. Each entry:
 *   { "id": "adc-xero-workflows",
 *     "keySha256": "<hex sha-256 of the secret key>",   // the key itself lives only with the caller
 *     "grantEmail": "<Xero login whose grant to use>",
 *     "allowedTenantIds": ["<tenant uuid>", ...],        // exact tenant IDs, never names, never a default
 *     "allowedTools": ["list-accounts", ...] }
 *
 * Every tools/call must name one allowed tenant ID in `organisation` and one allowed tool. Anything else is refused
 * before it reaches a Xero tool.
 */
export type ServiceClient = {
  id: string;
  keySha256: string;
  grantEmail: string;
  allowedTenantIds: string[];
  allowedTools: string[];
};

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSIVE_METHODS = new Set(["initialize", "ping", "tools/list"]);

export function loadServiceClients(raw: string | undefined): ServiceClient[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("SERVICE_CLIENTS must be a JSON array");
  return parsed.map((entry, i) => {
    const e = entry as Partial<ServiceClient>;
    if (!e.id || !/^[a-f0-9]{64}$/i.test(e.keySha256 ?? "") || !e.grantEmail) {
      throw new Error(`SERVICE_CLIENTS[${i}] needs id, 64-hex keySha256 and grantEmail`);
    }
    if (!e.allowedTenantIds?.length || !e.allowedTenantIds.every((t) => TENANT_ID.test(t))) {
      throw new Error(`SERVICE_CLIENTS[${i}].allowedTenantIds must be non-empty tenant UUIDs`);
    }
    if (!e.allowedTools?.length) throw new Error(`SERVICE_CLIENTS[${i}].allowedTools must be non-empty`);
    return e as ServiceClient;
  });
}

export function authenticateServiceClient(
  clients: ServiceClient[],
  presentedKey: unknown,
): ServiceClient | undefined {
  if (typeof presentedKey !== "string" || presentedKey.length < 24) return undefined;
  const digest = createHash("sha256").update(presentedKey).digest();
  return clients.find((c) => timingSafeEqual(digest, Buffer.from(c.keySha256, "hex")));
}

export type Authorization = { ok: true } | { ok: false; reason: string };

/** Checks one JSON-RPC request body (single message or batch) against the client's allow-lists. */
export function authorizeServiceBody(client: ServiceClient, body: unknown): Authorization {
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0) return { ok: false, reason: "empty request" };
  for (const m of messages) {
    const msg = m as { method?: unknown; params?: { name?: unknown; arguments?: Record<string, unknown> } };
    if (typeof msg?.method !== "string") return { ok: false, reason: "malformed JSON-RPC message" };
    if (PASSIVE_METHODS.has(msg.method) || msg.method.startsWith("notifications/")) continue;
    if (msg.method !== "tools/call") return { ok: false, reason: `method ${msg.method} not permitted` };
    const name = msg.params?.name;
    if (typeof name !== "string" || !client.allowedTools.includes(name)) {
      return { ok: false, reason: `tool ${String(name)} not permitted for this service client` };
    }
    const org = msg.params?.arguments?.organisation;
    if (typeof org !== "string" || !client.allowedTenantIds.some((t) => t.toLowerCase() === org.toLowerCase())) {
      return { ok: false, reason: "organisation must be an explicitly allowed tenant ID" };
    }
  }
  return { ok: true };
}

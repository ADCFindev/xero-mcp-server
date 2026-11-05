import { xeroClient } from "../clients/xero-client.js";

/**
 * In-memory cache for Xero reference data that changes rarely (chart of
 * accounts, tax rates, tracking categories, contacts, items, organisation
 * details). Entries are kept per organisation (tenant), expire after a fixed
 * time, and are cleared when this connector changes the same kind of data.
 * Only successful responses are stored. Transactions are never cached.
 */

export type ReferenceKind =
  | "accounts"
  | "taxRates"
  | "trackingCategories"
  | "organisation"
  | "contacts"
  | "contactGroups"
  | "items";

const MINUTE = 60 * 1000;

export const REFERENCE_TTL_MS: Record<ReferenceKind, number> = {
  accounts: 60 * MINUTE,
  taxRates: 60 * MINUTE,
  trackingCategories: 60 * MINUTE,
  organisation: 24 * 60 * MINUTE,
  contacts: 15 * MINUTE,
  contactGroups: 60 * MINUTE,
  items: 60 * MINUTE,
};

const MAX_ENTRIES = 1_000;

type Entry = { value: unknown; expiresAt: number };

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
let generation = 0;

function prefix(tenantId: string, kind: ReferenceKind): string {
  return `${tenantId}\u0000${kind}\u0000`;
}

function keyFor(tenantId: string, kind: ReferenceKind, args: unknown): string {
  return prefix(tenantId, kind) + JSON.stringify(args ?? null);
}

function currentTenantId(): string {
  return xeroClient.tenantId || "";
}

/**
 * Returns the cached value for this organisation, kind and arguments, or runs
 * the loader and caches its result. `refresh: true` skips the cached value.
 */
export async function cachedReference<T>(
  kind: ReferenceKind,
  args: unknown,
  loader: () => Promise<T>,
  options: { refresh?: boolean; now?: () => number } = {},
): Promise<T> {
  const tenantId = currentTenantId();
  // Without a known organisation the key would be shared, so do not cache.
  if (!tenantId) return loader();

  const now = options.now ?? Date.now;
  const key = keyFor(tenantId, kind, args);

  if (!options.refresh) {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now()) return hit.value as T;
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const startedAt = generation;
  const load = loader()
    .then((value) => {
      // A write that cleared this kind while the load ran makes it stale.
      if (startedAt === generation) {
        entries.delete(key);
        entries.set(key, { value, expiresAt: now() + REFERENCE_TTL_MS[kind] });
        while (entries.size > MAX_ENTRIES) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === load) inFlight.delete(key);
    });
  inFlight.set(key, load);
  return load;
}

/** Clears cached data of these kinds for the current organisation. */
export function invalidateReference(...kinds: ReferenceKind[]): void {
  const tenantId = currentTenantId();
  generation++;
  for (const kind of kinds) {
    const start = prefix(tenantId, kind);
    for (const key of [...entries.keys()]) {
      if (key.startsWith(start)) entries.delete(key);
    }
    for (const key of [...inFlight.keys()]) {
      if (key.startsWith(start)) inFlight.delete(key);
    }
  }
}

/** Clears the whole cache (tests). */
export function clearReferenceCache(): void {
  generation++;
  entries.clear();
  inFlight.clear();
}

/** Description for the `refresh` argument on tools that read cached data. */
export const REFRESH_DESCRIPTION =
  "Fetch fresh data from Xero instead of the connector's cache. Cached reference data is kept for up to 60 minutes " +
  "(contacts 15 minutes, organisation details 24 hours) and is cleared when this connector changes it; pass true " +
  "only if something was just changed directly in Xero.";

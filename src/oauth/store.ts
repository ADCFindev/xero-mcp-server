import fs from "node:fs/promises";
import path from "node:path";

import { randomToken, sha256 } from "./crypto.js";

export type RegisteredClient = {
  clientSecretHash?: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: number;
  lastUsedAt?: number;
};

export type PendingAuthorization = {
  kind: "mcp" | "connect";
  clientId?: string;
  redirectUri?: string;
  codeChallenge?: string;
  clientState?: string;
  createdAt: number;
};

export type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  grantId: string;
  expiresAt: number;
};

export type IssuedToken = {
  kind: "access" | "refresh";
  clientId: string;
  grantId: string;
  expiresAt: number;
};

export type XeroGrant = {
  xeroUserId: string;
  email: string;
  /** Encrypted with SecretBox. */
  accessToken: string;
  /** Encrypted with SecretBox. */
  refreshToken: string;
  accessTokenExpiresAt: number;
  defaultTenantId?: string;
  needsReconnect?: boolean;
  updatedAt: number;
};

type StoreData = {
  version: 1;
  clients: Record<string, RegisteredClient>;
  pending: Record<string, PendingAuthorization>;
  codes: Record<string, AuthorizationCode>;
  tokens: Record<string, IssuedToken>;
  grants: Record<string, XeroGrant>;
};

const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_CLIENTS = 200;

function emptyData(): StoreData {
  return { version: 1, clients: {}, pending: {}, codes: {}, tokens: {}, grants: {} };
}

/**
 * Small JSON-file store kept on a Railway volume. The service runs a single
 * replica, so an in-process write queue is enough to serialise updates.
 * Secrets that grant access (codes, MCP tokens, client secrets) are stored as
 * SHA-256 hashes; Xero tokens are stored encrypted.
 */
export class OAuthStore {
  private data: StoreData = emptyData();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly filePath: string) {}

  static async open(filePath: string): Promise<OAuthStore> {
    const store = new OAuthStore(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      store.data = { ...emptyData(), ...parsed, version: 1 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await store.persist();
    }
    return store;
  }

  /** Runs a read-modify-write operation exclusively and persists the result. */
  mutate<T>(operation: (data: StoreData) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const result = await operation(this.data);
      this.prune();
      await this.persist();
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  read<T>(operation: (data: StoreData) => T): T {
    return operation(this.data);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of Object.entries(this.data.pending)) {
      if (value.createdAt + PENDING_TTL_MS < now) delete this.data.pending[key];
    }
    for (const [key, value] of Object.entries(this.data.codes)) {
      if (value.expiresAt < now) delete this.data.codes[key];
    }
    for (const [key, value] of Object.entries(this.data.tokens)) {
      if (value.expiresAt < now) delete this.data.tokens[key];
    }
    const clientIds = Object.keys(this.data.clients);
    if (clientIds.length > MAX_CLIENTS) {
      clientIds
        .sort(
          (a, b) =>
            (this.data.clients[a]!.lastUsedAt ?? this.data.clients[a]!.createdAt) -
            (this.data.clients[b]!.lastUsedAt ?? this.data.clients[b]!.createdAt),
        )
        .slice(0, clientIds.length - MAX_CLIENTS)
        .forEach((id) => delete this.data.clients[id]);
    }
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  // ---- convenience helpers -------------------------------------------------

  async createPending(entry: Omit<PendingAuthorization, "createdAt">): Promise<string> {
    const state = randomToken();
    await this.mutate((data) => {
      data.pending[state] = { ...entry, createdAt: Date.now() };
    });
    return state;
  }

  takePending(state: string): Promise<PendingAuthorization | undefined> {
    return this.mutate((data) => {
      const entry = data.pending[state];
      delete data.pending[state];
      if (!entry || entry.createdAt + PENDING_TTL_MS < Date.now()) return undefined;
      return entry;
    });
  }

  async issueCode(entry: AuthorizationCode): Promise<string> {
    const code = randomToken();
    await this.mutate((data) => {
      data.codes[sha256(code)] = entry;
    });
    return code;
  }

  takeCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.mutate((data) => {
      const key = sha256(code);
      const entry = data.codes[key];
      delete data.codes[key];
      if (!entry || entry.expiresAt < Date.now()) return undefined;
      return entry;
    });
  }

  findToken(token: string, kind: IssuedToken["kind"]): IssuedToken | undefined {
    const entry = this.data.tokens[sha256(token)];
    if (!entry || entry.kind !== kind || entry.expiresAt < Date.now()) return undefined;
    if (!this.data.grants[entry.grantId]) return undefined;
    return entry;
  }
}

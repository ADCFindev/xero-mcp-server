import { AsyncLocalStorage } from "node:async_hooks";

import { OAuthConfig } from "./config.js";
import { SecretBox } from "./crypto.js";
import { OAuthStore, XeroGrant } from "./store.js";
import {
  XeroConnection,
  XeroTokenError,
  listConnections,
  refreshXeroToken,
} from "./xero-identity.js";

const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export class ReconnectRequiredError extends Error {
  constructor(readonly connectUrl: string) {
    super(
      `The Xero sign-in for this connector has expired or was revoked. Open ${connectUrl} to sign in to Xero again.`,
    );
    this.name = "ReconnectRequiredError";
  }
}

export class OrganisationSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganisationSelectionError";
  }
}

/** Per-request context for an MCP call authenticated with an OAuth token. */
export type OAuthRequestContext = {
  grantId: string;
  connections?: Promise<XeroConnection[]>;
};

export const oauthRequestContext = new AsyncLocalStorage<OAuthRequestContext>();

export class GrantService {
  private readonly box: SecretBox;
  private readonly refreshes = new Map<string, Promise<string>>();

  constructor(
    readonly config: OAuthConfig,
    readonly store: OAuthStore,
    readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.box = new SecretBox(config.encryptionKey);
  }

  get connectUrl(): string {
    return `${this.config.baseUrl}/connect`;
  }

  seal(value: string): string {
    return this.box.encrypt(value);
  }

  getGrant(grantId: string): XeroGrant | undefined {
    return this.store.read((data) => data.grants[grantId]);
  }

  /** Returns a Xero access token for the grant, refreshing it when close to expiry. */
  async getAccessToken(grantId: string): Promise<string> {
    const grant = this.getGrant(grantId);
    if (!grant || grant.needsReconnect) throw new ReconnectRequiredError(this.connectUrl);
    if (grant.accessTokenExpiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return this.box.decrypt(grant.accessToken);
    }

    // Xero rotates refresh tokens, so only one refresh per grant may run at a time.
    const inFlight = this.refreshes.get(grantId);
    if (inFlight) return inFlight;
    const refresh = this.refresh(grantId).finally(() => this.refreshes.delete(grantId));
    this.refreshes.set(grantId, refresh);
    return refresh;
  }

  private async refresh(grantId: string): Promise<string> {
    const grant = this.getGrant(grantId);
    if (!grant) throw new ReconnectRequiredError(this.connectUrl);
    try {
      const tokens = await refreshXeroToken(
        this.config,
        this.box.decrypt(grant.refreshToken),
        this.fetchImpl,
      );
      await this.store.mutate((data) => {
        const current = data.grants[grantId];
        if (!current) return;
        current.accessToken = this.seal(tokens.access_token);
        current.refreshToken = this.seal(tokens.refresh_token);
        current.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
        current.needsReconnect = false;
        current.updatedAt = Date.now();
      });
      return tokens.access_token;
    } catch (error) {
      if (error instanceof XeroTokenError && error.oauthError === "invalid_grant") {
        await this.store.mutate((data) => {
          const current = data.grants[grantId];
          if (current) current.needsReconnect = true;
        });
        throw new ReconnectRequiredError(this.connectUrl);
      }
      throw error;
    }
  }

  async getConnections(grantId: string): Promise<XeroConnection[]> {
    const context = oauthRequestContext.getStore();
    if (context && context.grantId === grantId) {
      context.connections ??= this.loadConnections(grantId);
      return context.connections;
    }
    return this.loadConnections(grantId);
  }

  private async loadConnections(grantId: string): Promise<XeroConnection[]> {
    const token = await this.getAccessToken(grantId);
    const connections = await listConnections(token, this.fetchImpl);
    return connections.filter((connection) => connection.tenantType === "ORGANISATION");
  }

  /**
   * Resolves the organisation a tool call should use: an explicit name or tenant
   * id, otherwise the grant's default, otherwise the only connected organisation.
   */
  async resolveOrganisation(grantId: string, requested?: string): Promise<XeroConnection> {
    const connections = await this.getConnections(grantId);
    if (connections.length === 0) {
      throw new OrganisationSelectionError(
        `No Xero organisations are connected yet. Open ${this.connectUrl} to connect one.`,
      );
    }
    const available = () => connections.map((c) => `"${c.tenantName}"`).join(", ");

    const wanted = requested?.trim();
    if (wanted) {
      const lower = wanted.toLowerCase();
      const byId = connections.find((c) => c.tenantId.toLowerCase() === lower);
      if (byId) return byId;
      const exact = connections.filter((c) => c.tenantName.toLowerCase() === lower);
      if (exact.length === 1) return exact[0]!;
      const partial = connections.filter((c) => c.tenantName.toLowerCase().includes(lower));
      if (partial.length === 1) return partial[0]!;
      if (partial.length > 1 || exact.length > 1) {
        const matches = (exact.length > 1 ? exact : partial)
          .map((c) => `"${c.tenantName}" (${c.tenantId})`)
          .join(", ");
        throw new OrganisationSelectionError(
          `"${wanted}" matches more than one organisation: ${matches}. Use the full name or tenant ID.`,
        );
      }
      throw new OrganisationSelectionError(
        `No connected organisation matches "${wanted}". Connected organisations: ${available()}. To connect another one, open ${this.connectUrl}.`,
      );
    }

    const defaultId = this.getGrant(grantId)?.defaultTenantId;
    const byDefault = defaultId && connections.find((c) => c.tenantId === defaultId);
    if (byDefault) return byDefault;
    if (connections.length === 1) return connections[0]!;
    throw new OrganisationSelectionError(
      `Specify which organisation to use with the "organisation" argument. Connected organisations: ${available()}.`,
    );
  }

  async setDefaultOrganisation(grantId: string, tenantId: string): Promise<void> {
    await this.store.mutate((data) => {
      const grant = data.grants[grantId];
      if (grant) grant.defaultTenantId = tenantId;
    });
  }
}

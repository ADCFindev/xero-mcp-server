import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  IXeroClientConfig,
  Organisation,
  TokenSet,
  XeroClient,
} from "xero-node";

import { ensureError } from "../helpers/ensure-error.js";

dotenv.config();

abstract class MCPXeroClient extends XeroClient {
  public tenantId: string;
  private shortCode: string;

  protected constructor(config?: IXeroClientConfig) {
    super(config);
    this.tenantId = "";
    this.shortCode = "";
  }

  public abstract authenticate(): Promise<void>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async updateTenants(fullOrgDetails?: boolean): Promise<any[]> {
    await super.updateTenants(fullOrgDetails);
    if (this.tenants && this.tenants.length > 0) {
      this.tenantId = this.tenants[0].tenantId;
    }
    return this.tenants;
  }

  private async getOrganisation(): Promise<Organisation> {
    await this.authenticate();

    const organisationResponse = await this.accountingApi.getOrganisations(
      this.tenantId || "",
    );

    const organisation = organisationResponse.body.organisations?.[0];

    if (!organisation) {
      throw new Error("Failed to retrieve organisation");
    }

    return organisation;
  }

  public async getShortCode(): Promise<string | undefined> {
    if (!this.shortCode) {
      try {
        const organisation = await this.getOrganisation();
        this.shortCode = organisation.shortCode ?? "";
      } catch (error: unknown) {
        const err = ensureError(error);

        throw new Error(
          `Failed to get Organisation short code: ${err.message}`,
        );
      }
    }
    return this.shortCode;
  }
}

class CustomConnectionsXeroClient extends MCPXeroClient {
  private readonly clientId: string;
  private readonly clientSecret: string;

  // Legacy scopes (deprecated but still supported for existing apps)
  private readonly XERO_DEFAULT_AUTH_SCOPES_V1 = [
    "accounting.transactions",
    "accounting.contacts",
    "accounting.settings",
    "accounting.reports.read",
    "payroll.settings",
    "payroll.employees",
    "payroll.timesheets",
  ].join(" ");

  // Granular scopes (required for new apps)
  private readonly XERO_DEFAULT_AUTH_SCOPES_V2 = [
    "accounting.invoices",
    "accounting.payments",
    "accounting.banktransactions",
    "accounting.manualjournals",
    "accounting.reports.aged.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.contacts",
    "accounting.settings",
    "payroll.settings",
    "payroll.employees",
    "payroll.timesheets",
  ].join(" ");

  constructor(config: {
    clientId: string;
    clientSecret: string;
    grantType: string;
  }) {
    super(config);
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  private formatTokenError(error: unknown, context: string): Error {
    const axiosError = error as AxiosError;
    const data = axiosError.response?.data;
    const message =
      typeof data === "object" ? JSON.stringify(data) : data || axiosError.message;
    return new Error(`Failed to get Xero token${context}: ${message}`);
  }

  public async getClientCredentialsToken(): Promise<TokenSet> {
    // If XERO_SCOPES is set, use that
    if (process.env.XERO_SCOPES) {                                                                                                                                                     
      try {
        return await this.requestToken(process.env.XERO_SCOPES);
      } catch (envError) {
        throw this.formatTokenError(envError, " with XERO_SCOPES");
      }
    }

    // Else if XERO_SCOPES is not set, try V1 scopes first (for existing apps), fallback to V2 scopes (for new apps) only on invalid_scope error
    try {
      return await this.requestToken(this.XERO_DEFAULT_AUTH_SCOPES_V1);
    } catch (error) {
      const axiosError = error as AxiosError;
      const isInvalidScope =
        axiosError.response?.status === 400 &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (axiosError.response?.data as any)?.error === "invalid_scope";

      if (!isInvalidScope) {
        throw this.formatTokenError(error, " with V1 scopes");
      }

      try {
        return await this.requestToken(this.XERO_DEFAULT_AUTH_SCOPES_V2);
      } catch (v2Error) {
        throw this.formatTokenError(v2Error, " with V2 scopes");
      }
    }
  }

  private async requestToken(scope: string): Promise<TokenSet> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await axios.post(
      "https://identity.xero.com/connect/token",
      `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      },
    );

    // Get the tenant ID from the connections endpoint
    const token = response.data.access_token;
    const connectionsResponse = await axios.get(
      "https://api.xero.com/connections",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );

    if (connectionsResponse.data && connectionsResponse.data.length > 0) {
      this.tenantId = connectionsResponse.data[0].tenantId;
    }

    return response.data;
  }

  public async authenticate() {
    const tokenResponse = await this.getClientCredentialsToken();

    this.setTokenSet({
      access_token: tokenResponse.access_token,
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
    });
  }
}

class BearerTokenXeroClient extends MCPXeroClient {
  private readonly bearerToken: string;

  constructor(config: { bearerToken: string }) {
    super();
    this.bearerToken = config.bearerToken;
  }

  async authenticate(): Promise<void> {
    this.setTokenSet({
      access_token: this.bearerToken,
    });

    await this.updateTenants();
  }
}

class RequestScopedXeroClient extends MCPXeroClient {
  constructor(
    private readonly accessToken: string,
    tenantId: string,
  ) {
    super();
    this.tenantId = tenantId;
    this.setTokenSet({ access_token: accessToken });
  }

  async authenticate(): Promise<void> {
    this.setTokenSet({ access_token: this.accessToken });
  }
}

export class XeroMcpAuthorizationError extends Error {
  constructor() {
    super("Xero authorization for the selected organisation was rejected.");
    this.name = "XeroMcpAuthorizationError";
  }
}

export class XeroMcpAuthorizationUnavailableError extends Error {
  constructor() {
    super("Xero authorization could not be verified right now.");
    this.name = "XeroMcpAuthorizationUnavailableError";
  }
}

export type XeroMcpAuthorizationContext = {
  accessToken: string;
  tenantId: string;
};

type XeroConnectionsLoader = (accessToken: string) => Promise<unknown>;

const requestScopedClients = new AsyncLocalStorage<MCPXeroClient>();

function createConfiguredXeroClient(): MCPXeroClient | null {
  // The authenticated HTTP service must never fall back to process-wide Xero
  // credentials. Its only Xero client is created inside the request context.
  if (process.env.MCP_API_KEY || process.env.PORT) return null;

  const client_id = process.env.XERO_CLIENT_ID;
  const client_secret = process.env.XERO_CLIENT_SECRET;
  const bearer_token = process.env.XERO_CLIENT_BEARER_TOKEN;
  if (bearer_token) {
    return new BearerTokenXeroClient({ bearerToken: bearer_token });
  }
  if (client_id && client_secret) {
    return new CustomConnectionsXeroClient({
      clientId: client_id,
      clientSecret: client_secret,
      grantType: "client_credentials",
    });
  }
  return null;
}

const configuredXeroClient = createConfiguredXeroClient();

function currentXeroClient(): MCPXeroClient {
  const client = requestScopedClients.getStore() ?? configuredXeroClient;
  if (!client) {
    throw new XeroMcpAuthorizationError();
  }
  return client;
}

async function loadXeroConnections(accessToken: string): Promise<unknown> {
  const response = await axios.get<unknown>("https://api.xero.com/connections", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    timeout: 8_000,
  });
  return response.data;
}

export async function withXeroMcpAuthorization<T>(
  authorization: XeroMcpAuthorizationContext,
  operation: () => T | Promise<T>,
  connectionsLoader: XeroConnectionsLoader = loadXeroConnections,
): Promise<T> {
  const { accessToken, tenantId } = authorization;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 8_192 ||
    /\s/.test(accessToken) ||
    typeof tenantId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
  ) {
    throw new XeroMcpAuthorizationError();
  }

  let connections: unknown;
  try {
    connections = await connectionsLoader(accessToken);
  } catch (error) {
    const status = (error as AxiosError).response?.status;
    if (status === 401 || status === 403) {
      throw new XeroMcpAuthorizationError();
    }
    throw new XeroMcpAuthorizationUnavailableError();
  }

  if (
    !Array.isArray(connections) ||
    !connections.some(
      (connection) =>
        typeof connection === "object" &&
        connection !== null &&
        "tenantId" in connection &&
        connection.tenantId === tenantId,
    )
  ) {
    throw new XeroMcpAuthorizationError();
  }

  const client = new RequestScopedXeroClient(accessToken, tenantId);
  return requestScopedClients.run(client, operation);
}

export const xeroClient = new Proxy({} as MCPXeroClient, {
  get(_target, property) {
    const client = currentXeroClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    return Reflect.set(currentXeroClient(), property, value);
  },
});

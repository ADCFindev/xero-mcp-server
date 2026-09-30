import { OAuthConfig } from "./config.js";

/** Thin client for Xero's identity endpoints (standard OAuth 2.0 Web app). */

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";

export type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token?: string;
  token_type?: string;
};

export type XeroIdentity = {
  xeroUserId: string;
  email: string;
};

export type XeroConnection = {
  tenantId: string;
  tenantName: string;
  tenantType: string;
};

export class XeroTokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly oauthError?: string,
  ) {
    super(message);
    this.name = "XeroTokenError";
  }
}

export function callbackUrl(config: OAuthConfig): string {
  return `${config.baseUrl}/callback`;
}

export function buildXeroAuthorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.xeroClientId);
  url.searchParams.set("redirect_uri", callbackUrl(config));
  url.searchParams.set("scope", config.xeroScopes);
  url.searchParams.set("state", state);
  return url.toString();
}

async function requestToken(
  config: OAuthConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<XeroTokenResponse> {
  const credentials = Buffer.from(`${config.xeroClientId}:${config.xeroClientSecret}`).toString(
    "base64",
  );
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as Partial<XeroTokenResponse> & {
    error?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new XeroTokenError(
      `Xero token request failed (${response.status}${body.error ? `: ${body.error}` : ""}).`,
      response.status,
      body.error,
    );
  }
  return body as XeroTokenResponse;
}

export function exchangeCode(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XeroTokenResponse> {
  return requestToken(
    config,
    { grant_type: "authorization_code", code, redirect_uri: callbackUrl(config) },
    fetchImpl,
  );
}

export function refreshXeroToken(
  config: OAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XeroTokenResponse> {
  return requestToken(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}

/**
 * Reads the identity claims from the id_token. The token comes straight from
 * Xero's token endpoint over TLS in the authorization-code exchange, so the
 * claims are trusted without re-verifying the signature (OIDC Core 3.1.3.7).
 */
export function readIdentity(idToken: string | undefined): XeroIdentity {
  if (!idToken) throw new Error("Xero did not return an id_token; the openid scope is required.");
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Malformed id_token.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  const xeroUserId =
    (typeof claims.xero_userid === "string" && claims.xero_userid) ||
    (typeof claims.sub === "string" && claims.sub) ||
    "";
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (!xeroUserId || !email) throw new Error("The Xero id_token has no user id or email.");
  return { xeroUserId, email };
}

export async function listConnections(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XeroConnection[]> {
  const response = await fetchImpl(CONNECTIONS_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new XeroTokenError(`Xero connections request failed (${response.status}).`, response.status);
  }
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return body
    .filter(
      (item): item is XeroConnection =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as XeroConnection).tenantId === "string",
    )
    .map((item) => ({
      tenantId: item.tenantId,
      tenantName: item.tenantName ?? "(unnamed)",
      tenantType: item.tenantType ?? "ORGANISATION",
    }));
}

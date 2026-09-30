import http from "node:http";

import { randomToken, safeEqual, sha256, verifyPkce } from "./crypto.js";
import { GrantService } from "./grants.js";
import { RegisteredClient } from "./store.js";
import {
  buildXeroAuthorizeUrl,
  exchangeCode,
  listConnections,
  readIdentity,
} from "./xero-identity.js";

const ACCESS_TOKEN_TTL_S = 60 * 60;
const REFRESH_TOKEN_TTL_S = 60 * 24 * 60 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

// ---- small HTTP helpers ------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function sendHtml(res: http.ServerResponse, status: number, title: string, bodyHtml: string): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.5;color:#1f2328}h1{font-size:1.3rem}li{margin:4px 0}code{background:#f2f2f2;padding:1px 4px;border-radius:4px}</style>
</head><body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`);
}

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  const type = String(req.headers["content-type"] ?? "");
  if (type.includes("application/json")) {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function withParams(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---- OAuth routes ------------------------------------------------------------

export class OAuthRoutes {
  constructor(private readonly grants: GrantService) {}

  private get base(): string {
    return this.grants.config.baseUrl;
  }

  get resourceMetadataUrl(): string {
    return `${this.base}/.well-known/oauth-protected-resource/mcp`;
  }

  /** WWW-Authenticate header value that points MCP clients at the metadata. */
  get challenge(): string {
    return `Bearer resource_metadata="${this.resourceMetadataUrl}"`;
  }

  /** Returns the grant id for a valid MCP access token, or undefined. */
  authenticate(req: http.IncomingMessage): string | undefined {
    const header = req.headers.authorization;
    if (typeof header !== "string") return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) return undefined;
    return this.grants.store.findToken(match[1]!, "access")?.grantId;
  }

  /** Handles OAuth endpoints. Returns false when the path is not an OAuth route. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const method = req.method ?? "GET";
    const route = url.pathname.replace(/\/+$/, "") || "/";

    if (method === "OPTIONS" && (route.startsWith("/.well-known/") || route === "/token" || route === "/register")) {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
      });
      res.end();
      return true;
    }

    if (method === "GET" && route.startsWith("/.well-known/oauth-protected-resource")) {
      sendJson(res, 200, {
        resource: `${this.base}/mcp`,
        authorization_servers: [this.base],
        bearer_methods_supported: ["header"],
        resource_name: "ADC Findev Xero MCP",
      });
      return true;
    }

    if (
      method === "GET" &&
      (route.startsWith("/.well-known/oauth-authorization-server") ||
        route.startsWith("/.well-known/openid-configuration"))
    ) {
      sendJson(res, 200, {
        issuer: this.base,
        authorization_endpoint: `${this.base}/authorize`,
        token_endpoint: `${this.base}/token`,
        registration_endpoint: `${this.base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        scopes_supported: ["xero"],
      });
      return true;
    }

    if (route === "/register" && method === "POST") {
      await this.register(req, res);
      return true;
    }
    if (route === "/authorize" && method === "GET") {
      await this.authorize(res, url);
      return true;
    }
    if (route === "/connect" && method === "GET") {
      const state = await this.grants.store.createPending({ kind: "connect" });
      redirect(res, buildXeroAuthorizeUrl(this.grants.config, state));
      return true;
    }
    if (route === "/callback" && method === "GET") {
      await this.callback(res, url);
      return true;
    }
    if (route === "/token" && method === "POST") {
      await this.token(req, res);
      return true;
    }
    return false;
  }

  // RFC 7591 dynamic client registration (used by claude.ai custom connectors).
  private async register(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid_client_metadata", error_description: "Invalid body." });
      return;
    }
    const redirectUris = body.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > 10 ||
      !redirectUris.every(isAllowedRedirectUri)
    ) {
      sendJson(res, 400, {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be https URLs (or http on localhost).",
      });
      return;
    }
    const authMethod =
      typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod)) {
      sendJson(res, 400, { error: "invalid_client_metadata", error_description: "Unsupported auth method." });
      return;
    }
    const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 200) : undefined;

    const clientId = randomToken(16);
    const clientSecret = authMethod === "none" ? undefined : randomToken();
    const client: RegisteredClient = {
      redirectUris: redirectUris as string[],
      clientName,
      clientSecretHash: clientSecret ? sha256(clientSecret) : undefined,
      createdAt: Date.now(),
    };
    await this.grants.store.mutate((data) => {
      data.clients[clientId] = client;
    });
    sendJson(res, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_name: clientName,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: authMethod,
    });
  }

  private async authorize(res: http.ServerResponse, url: URL): Promise<void> {
    const params = url.searchParams;
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const client = this.grants.store.read((data) => data.clients[clientId]);

    // Without a valid client + redirect URI we must not redirect anywhere.
    if (!client) {
      sendHtml(res, 400, "Unknown client", "<p>This connector is not registered. Remove it and add it again.</p>");
      return;
    }
    const effectiveRedirect = redirectUri || (client.redirectUris.length === 1 ? client.redirectUris[0]! : "");
    if (!client.redirectUris.includes(effectiveRedirect)) {
      sendHtml(res, 400, "Invalid redirect", "<p>The redirect URI does not match the registered connector.</p>");
      return;
    }

    const clientState = params.get("state") ?? undefined;
    const fail = (error: string, description: string) =>
      redirect(res, withParams(effectiveRedirect, { error, error_description: description, state: clientState }));

    if (params.get("response_type") !== "code") {
      fail("unsupported_response_type", "Only response_type=code is supported.");
      return;
    }
    const codeChallenge = params.get("code_challenge") ?? "";
    if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
      fail("invalid_request", "PKCE with S256 is required.");
      return;
    }

    const state = await this.grants.store.createPending({
      kind: "mcp",
      clientId,
      redirectUri: effectiveRedirect,
      codeChallenge,
      clientState,
    });
    redirect(res, buildXeroAuthorizeUrl(this.grants.config, state));
  }

  private async callback(res: http.ServerResponse, url: URL): Promise<void> {
    const params = url.searchParams;
    const pending = await this.grants.store.takePending(params.get("state") ?? "");
    if (!pending) {
      sendHtml(res, 400, "Sign-in expired", "<p>This sign-in link has expired. Start again from Claude or from <code>/connect</code>.</p>");
      return;
    }

    const fail = (error: string, description: string) => {
      if (pending.kind === "mcp" && pending.redirectUri) {
        redirect(res, withParams(pending.redirectUri, { error, error_description: description, state: pending.clientState }));
      } else {
        sendHtml(res, 400, "Xero sign-in failed", `<p>${escapeHtml(description)}</p>`);
      }
    };

    const xeroError = params.get("error");
    if (xeroError) {
      fail("access_denied", `Xero returned: ${xeroError}`);
      return;
    }
    const code = params.get("code");
    if (!code) {
      fail("invalid_request", "Xero did not return an authorization code.");
      return;
    }

    const config = this.grants.config;
    let grantId: string;
    let connectionNames: string[] = [];
    try {
      const tokens = await exchangeCode(config, code, this.grants.fetchImpl);
      const identity = readIdentity(tokens.id_token);
      if (!config.allowedEmails.has(identity.email)) {
        console.warn("Xero sign-in rejected for a user that is not on ALLOWED_XERO_EMAILS.");
        fail("access_denied", `The Xero user ${identity.email} is not allowed to use this connector.`);
        return;
      }
      grantId = await this.grants.store.mutate((data) => {
        const existing = Object.entries(data.grants).find(([, g]) => g.xeroUserId === identity.xeroUserId);
        const id = existing?.[0] ?? randomToken(16);
        data.grants[id] = {
          ...(existing?.[1] ?? {}),
          xeroUserId: identity.xeroUserId,
          email: identity.email,
          accessToken: this.grants.seal(tokens.access_token),
          refreshToken: this.grants.seal(tokens.refresh_token),
          accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
          needsReconnect: false,
          updatedAt: Date.now(),
        };
        return id;
      });
      if (pending.kind === "connect") {
        connectionNames = (await listConnections(tokens.access_token, this.grants.fetchImpl))
          .filter((c) => c.tenantType === "ORGANISATION")
          .map((c) => c.tenantName);
      }
    } catch (error) {
      console.error("Xero callback failed:", (error as Error).message);
      fail("server_error", "Could not complete the Xero sign-in. Please try again.");
      return;
    }

    if (pending.kind === "connect") {
      const list = connectionNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
      sendHtml(
        res,
        200,
        "Xero connected",
        `<p>These organisations are now available in Claude:</p><ul>${list || "<li>(none)</li>"}</ul>
<p>To add another client, open <code>${escapeHtml(this.grants.connectUrl)}</code> again and pick that organisation. You can close this page.</p>`,
      );
      return;
    }

    const mcpCode = await this.grants.store.issueCode({
      clientId: pending.clientId!,
      redirectUri: pending.redirectUri!,
      codeChallenge: pending.codeChallenge!,
      grantId,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    redirect(res, withParams(pending.redirectUri!, { code: mcpCode, state: pending.clientState }));
  }

  private authenticateClient(
    req: http.IncomingMessage,
    body: Record<string, string>,
  ): { clientId: string; client: RegisteredClient } | undefined {
    let clientId = body.client_id;
    let clientSecret = body.client_secret;
    const header = req.headers.authorization;
    if (typeof header === "string" && /^Basic\s+/i.test(header)) {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ""), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        clientId = decodeURIComponent(decoded.slice(0, separator));
        clientSecret = decodeURIComponent(decoded.slice(separator + 1));
      }
    }
    if (!clientId) return undefined;
    const client = this.grants.store.read((data) => data.clients[clientId!]);
    if (!client) return undefined;
    if (client.clientSecretHash) {
      if (!clientSecret || !safeEqual(sha256(clientSecret), client.clientSecretHash)) return undefined;
    }
    return { clientId, client };
  }

  private async issueTokens(clientId: string, grantId: string) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const now = Date.now();
    await this.grants.store.mutate((data) => {
      data.tokens[sha256(accessToken)] = {
        kind: "access",
        clientId,
        grantId,
        expiresAt: now + ACCESS_TOKEN_TTL_S * 1000,
      };
      data.tokens[sha256(refreshToken)] = {
        kind: "refresh",
        clientId,
        grantId,
        expiresAt: now + REFRESH_TOKEN_TTL_S * 1000,
      };
      const client = data.clients[clientId];
      if (client) client.lastUsedAt = now;
    });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: "xero",
    };
  }

  private async token(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: Record<string, string>;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }
    const authenticated = this.authenticateClient(req, body);
    if (!authenticated) {
      sendJson(res, 401, { error: "invalid_client" });
      return;
    }
    const { clientId } = authenticated;

    if (body.grant_type === "authorization_code") {
      const code = await this.grants.store.takeCode(body.code ?? "");
      if (
        !code ||
        code.clientId !== clientId ||
        (body.redirect_uri && body.redirect_uri !== code.redirectUri) ||
        !verifyPkce(body.code_verifier ?? "", code.codeChallenge)
      ) {
        sendJson(res, 400, { error: "invalid_grant" });
        return;
      }
      sendJson(res, 200, await this.issueTokens(clientId, code.grantId));
      return;
    }

    if (body.grant_type === "refresh_token") {
      const presented = body.refresh_token ?? "";
      // Rotate: the presented refresh token is single use (checked and consumed atomically).
      const grantId = await this.grants.store.mutate((data) => {
        const existing = this.grants.store.findToken(presented, "refresh");
        if (!existing || existing.clientId !== clientId) return undefined;
        delete data.tokens[sha256(presented)];
        return existing.grantId;
      });
      if (!grantId) {
        sendJson(res, 400, { error: "invalid_grant" });
        return;
      }
      sendJson(res, 200, await this.issueTokens(clientId, grantId));
      return;
    }

    sendJson(res, 400, { error: "unsupported_grant_type" });
  }
}

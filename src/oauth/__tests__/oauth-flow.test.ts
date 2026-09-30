import { it } from "vitest";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { loadOAuthConfig } from "../config.js";
import { GrantService, oauthRequestContext } from "../grants.js";
import { OAuthRoutes } from "../routes.js";
import { OAuthStore } from "../store.js";

it("completes the claude.ai OAuth flow against a fake Xero", async () => {

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oauth-e2e-"));
  const env = {
    PUBLIC_BASE_URL: "https://mcp.example.test",
    XERO_CLIENT_ID: "xid",
    XERO_CLIENT_SECRET: "xsecret",
    TOKEN_ENCRYPTION_KEY: "k".repeat(40),
    ALLOWED_XERO_EMAILS: "Dragos@ADC-accountancy.com, other@x.com",
    OAUTH_STORE_PATH: path.join(dir, "store.json"),
  } as NodeJS.ProcessEnv;

  const cfg = loadOAuthConfig(env);
  assert.ok(cfg.enabled);
  const config = cfg.config;
  assert.match(config.xeroScopes, /offline_access/);
  assert.match(config.xeroScopes, /openid/);
  assert.equal(loadOAuthConfig({}).enabled, false);

  // ---- fake Xero ------------------------------------------------------------
  let userEmail = "dragos@adc-accountancy.com";
  let tokenCounter = 0;
  const validRefresh = new Set<string>();
  const calls: string[] = [];
  const idToken = (email: string) =>
    `h.${Buffer.from(JSON.stringify({ xero_userid: "user-1", email })).toString("base64url")}.s`;
  const connections = [
    { tenantId: "11111111-1111-1111-1111-111111111111", tenantName: "Kapow Meggings Ltd", tenantType: "ORGANISATION" },
    { tenantId: "22222222-2222-2222-2222-222222222222", tenantName: "Kapow LLC", tenantType: "ORGANISATION" },
    { tenantId: "33333333-3333-3333-3333-333333333333", tenantName: "Some Practice", tenantType: "PRACTICE" },
  ];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === "https://identity.xero.com/connect/token") {
      assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, `Basic ${Buffer.from("xid:xsecret").toString("base64")}`);
      const params = new URLSearchParams(String(init?.body));
      if (params.get("grant_type") === "authorization_code") {
        assert.equal(params.get("redirect_uri"), "https://mcp.example.test/callback");
      } else if (params.get("grant_type") === "refresh_token") {
        if (!validRefresh.has(params.get("refresh_token")!)) return json(400, { error: "invalid_grant" });
        validRefresh.delete(params.get("refresh_token")!);
      }
      tokenCounter++;
      const refresh = `xr${tokenCounter}`;
      validRefresh.add(refresh);
      return json(200, { access_token: `xa${tokenCounter}`, refresh_token: refresh, expires_in: 1800, id_token: idToken(userEmail) });
    }
    if (url === "https://api.xero.com/connections") return json(200, connections);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  // ---- server ---------------------------------------------------------------
  let store = await OAuthStore.open(config.storePath);
  let grants = new GrantService(config, store, fakeFetch);
  let routes = new OAuthRoutes(grants);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (await routes.handle(req, res, url)) return;
    if (url.pathname === "/mcp") {
      const grantId = routes.authenticate(req);
      if (!grantId) {
        res.writeHead(401, { "www-authenticate": routes.challenge });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(grantId);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { redirect: "manual", headers });
  const post = (p: string, body: Record<string, unknown> | string, headers: Record<string, string> = {}) =>
    fetch(base + p, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  // 1. discovery
  let r = await get("/mcp");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("www-authenticate"), 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"');
  r = await get("/.well-known/oauth-protected-resource/mcp");
  assert.deepEqual((await r.json()).authorization_servers, ["https://mcp.example.test"]);
  r = await get("/.well-known/oauth-authorization-server");
  const meta = await r.json();
  assert.equal(meta.token_endpoint, "https://mcp.example.test/token");
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);

  // 2. registration
  r = await post("/register", { redirect_uris: ["http://evil.com/cb"] });
  assert.equal(r.status, 400);
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
  r = await post("/register", { redirect_uris: [REDIRECT], client_name: "Claude", token_endpoint_auth_method: "none" });
  assert.equal(r.status, 201);
  const client = await r.json();
  assert.ok(client.client_id && !client.client_secret);

  // 3. authorize
  const verifier = crypto.randomBytes(40).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const authorizeQuery = (extra: Record<string, string> = {}) =>
    "/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "claude-state",
      ...extra,
    });
  r = await get(authorizeQuery({ redirect_uri: "https://evil.com/cb" }));
  assert.equal(r.status, 400, "mismatched redirect must not redirect");
  r = await get(authorizeQuery({ code_challenge_method: "plain" }));
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location")!, /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=invalid_request/);
  r = await get(authorizeQuery());
  assert.equal(r.status, 302);
  const xeroUrl = new URL(r.headers.get("location")!);
  assert.equal(xeroUrl.origin + xeroUrl.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(xeroUrl.searchParams.get("redirect_uri"), "https://mcp.example.test/callback");
  const xeroState = xeroUrl.searchParams.get("state")!;

  // 4. callback
  r = await get(`/callback?code=xerocode&state=${xeroState}`);
  assert.equal(r.status, 302);
  const back = new URL(r.headers.get("location")!);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "claude-state");
  const mcpCode = back.searchParams.get("code")!;
  r = await get(`/callback?code=xerocode&state=${xeroState}`);
  assert.equal(r.status, 400, "state is single use");

  // 5. token exchange
  r = await post("/token", new URLSearchParams({ grant_type: "authorization_code", code: mcpCode, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) }).toString());
  assert.equal(r.status, 400, "wrong verifier rejected (and code consumed)");
  // start again to get a fresh code
  r = await get(authorizeQuery());
  let st = new URL(r.headers.get("location")!).searchParams.get("state")!;
  r = await get(`/callback?code=xerocode2&state=${st}`);
  const code2 = new URL(r.headers.get("location")!).searchParams.get("code")!;
  r = await post("/token", new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString());
  assert.equal(r.status, 200);
  const tokens = await r.json();
  assert.equal(tokens.token_type, "Bearer");

  // 6. MCP auth
  r = await get("/mcp", { authorization: `Bearer ${tokens.access_token}` });
  assert.equal(r.status, 200);
  const grantId = await r.text();
  r = await get("/mcp", { authorization: `Bearer ${tokens.refresh_token}` });
  assert.equal(r.status, 401, "refresh token is not an access token");

  // 7. refresh rotation
  r = await post("/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
  assert.equal(r.status, 200);
  const tokens2 = await r.json();
  r = await post("/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
  assert.equal(r.status, 400, "old refresh token is single use");
  r = await post("/token", { grant_type: "refresh_token", refresh_token: tokens2.refresh_token, client_id: "someone-else" });
  assert.equal(r.status, 401);

  // 8. grant: access token + refresh + organisation resolution
  assert.equal(await grants.getAccessToken(grantId), `xa${tokenCounter}`);
  await store.mutate((data) => { data.grants[grantId]!.accessTokenExpiresAt = Date.now(); });
  const [a, b] = await Promise.all([grants.getAccessToken(grantId), grants.getAccessToken(grantId)]);
  assert.equal(a, b, "concurrent refreshes share one Xero call");
  const orgs = await grants.getConnections(grantId);
  assert.deepEqual(orgs.map((o) => o.tenantName), ["Kapow Meggings Ltd", "Kapow LLC"], "practice filtered out");
  assert.equal((await grants.resolveOrganisation(grantId, "kapow llc")).tenantId, connections[1]!.tenantId);
  assert.equal((await grants.resolveOrganisation(grantId, "meggings")).tenantId, connections[0]!.tenantId);
  assert.equal((await grants.resolveOrganisation(grantId, connections[0]!.tenantId)).tenantName, "Kapow Meggings Ltd");
  await assert.rejects(grants.resolveOrganisation(grantId, "kapow"), /more than one/);
  await assert.rejects(grants.resolveOrganisation(grantId, "acme"), /No connected organisation/);
  await assert.rejects(grants.resolveOrganisation(grantId), /Specify which organisation/);
  await grants.setDefaultOrganisation(grantId, connections[1]!.tenantId);
  assert.equal((await grants.resolveOrganisation(grantId)).tenantName, "Kapow LLC");
  // per-request connection caching
  const before = calls.length;
  await oauthRequestContext.run({ grantId }, async () => {
    await grants.resolveOrganisation(grantId, "Kapow LLC");
    await grants.getConnections(grantId);
  });
  assert.equal(calls.filter((u) => u.endsWith("/connections")).length - calls.slice(0, before).filter((u) => u.endsWith("/connections")).length, 1);

  // 9. revoked Xero refresh token -> reconnect message
  validRefresh.clear();
  await store.mutate((data) => { data.grants[grantId]!.accessTokenExpiresAt = 0; });
  await assert.rejects(grants.getAccessToken(grantId), /\/connect/);
  assert.equal(grants.getGrant(grantId)!.needsReconnect, true);

  // 10. /connect flow re-links the same grant and clears needsReconnect
  r = await get("/connect");
  st = new URL(r.headers.get("location")!).searchParams.get("state")!;
  r = await get(`/callback?code=xerocode3&state=${st}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Kapow LLC/);
  assert.doesNotMatch(html, /Some Practice/);
  assert.equal(grants.getGrant(grantId)!.needsReconnect, false);
  assert.equal(store.read((d) => Object.keys(d.grants).length), 1, "same Xero user -> same grant");
  assert.equal(grants.getGrant(grantId)!.defaultTenantId, connections[1]!.tenantId, "default kept");

  // 11. not-allowed user
  userEmail = "stranger@example.com";
  r = await get("/connect");
  st = new URL(r.headers.get("location")!).searchParams.get("state")!;
  r = await get(`/callback?code=xerocode4&state=${st}`);
  assert.equal(r.status, 400);
  r = await get(authorizeQuery());
  st = new URL(r.headers.get("location")!).searchParams.get("state")!;
  r = await get(`/callback?code=xerocode5&state=${st}`);
  assert.match(r.headers.get("location")!, /error=access_denied/);
  userEmail = "dragos@adc-accountancy.com";

  // 12. persistence + encryption at rest
  const raw = await fs.readFile(config.storePath, "utf8");
  assert.ok(!raw.includes(tokens2.access_token), "MCP tokens stored hashed");
  assert.ok(!/"xa\d+"/.test(raw) && !/"xr\d+"/.test(raw), "Xero tokens stored encrypted");
  store = await OAuthStore.open(config.storePath);
  grants = new GrantService(config, store, fakeFetch);
  routes = new OAuthRoutes(grants);
  r = await get("/mcp", { authorization: `Bearer ${tokens2.access_token}` });
  assert.equal(r.status, 200, "token survives restart");
  assert.match(await grants.getAccessToken(grantId), /^xa\d+$/);

  // 13. confidential client with basic auth
  r = await post("/register", { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
  const conf = await r.json();
  assert.ok(conf.client_secret);
  r = await post("/token", { grant_type: "refresh_token", refresh_token: "nope" }, { authorization: `Basic ${Buffer.from(`${conf.client_id}:wrong`).toString("base64")}` });
  assert.equal(r.status, 401);

  server.close();

});

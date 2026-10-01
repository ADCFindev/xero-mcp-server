import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  withXeroMcpAuthorization,
  XeroMcpAuthorizationError,
  XeroMcpAuthorizationUnavailableError,
} from "./clients/xero-client.js";
import { parseXeroMcpAuthorization } from "./helpers/xero-mcp-auth.js";
import { loadOAuthConfig } from "./oauth/config.js";
import { GrantService, oauthRequestContext } from "./oauth/grants.js";
import { organisationTools, withOrganisation } from "./oauth/organisation-tools.js";
import { OAuthRoutes } from "./oauth/routes.js";
import { OAuthStore } from "./oauth/store.js";
import ReadCouplerExportTool from "./tools/coupler/read-coupler-export.tool.js";
import { ToolFactory } from "./tools/tool-factory.js";

const port = Number(process.env.PORT || 3000);

// Multi-client OAuth mode (Xero Web app + MCP OAuth for claude.ai connectors).
// Set up in main() before the server starts listening.
let oauth: { routes: OAuthRoutes; grants: GrantService } | null = null;

function isAuthorized(req: http.IncomingMessage): boolean {
  const apiKey = req.headers["x-api-key"];

  return (
    typeof apiKey === "string" &&
    !!process.env.MCP_API_KEY &&
    apiKey === process.env.MCP_API_KEY
  );
}

function sendError(
  res: http.ServerResponse,
  status: number,
  message: string,
): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function buildServer(grants?: GrantService): McpServer {
  const server = new McpServer({
    name: "ADC Findev Xero MCP",
    version: "1.0.0",
  });

  if (grants) {
    ToolFactory(server, withOrganisation(grants), [
      ...organisationTools(grants),
      ReadCouplerExportTool(),
    ]);
  } else {
    ToolFactory(server, undefined, [ReadCouplerExportTool()]);
  }

  return server;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const bodyText = Buffer.concat(chunks).toString("utf8");
  return bodyText ? JSON.parse(bodyText) : undefined;
}

// MCP request authenticated with an OAuth access token issued by /token.
async function handleOAuthMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  active: { routes: OAuthRoutes; grants: GrantService },
): Promise<void> {
  const grantId = active.routes.authenticate(req);
  if (!grantId) {
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": active.routes.challenge,
    });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json", allow: "POST" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const body = await readJsonBody(req);
  const server = buildServer(active.grants);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  transport.onerror = () => {
    console.error("MCP transport error.");
  };

  await oauthRequestContext.run({ grantId }, async () => {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
}

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, {
        "content-type": "application/json",
      });

      res.end(
        JSON.stringify({
          ok: true,
          service: "ADC Findev Xero MCP",
        })
      );

      return;
    }

    if (oauth && (await oauth.routes.handle(req, res, url))) {
      return;
    }

    // OAuth-mode MCP calls: no x-api-key header, bearer token issued by /token.
    if (oauth && url.pathname === "/mcp" && req.headers["x-api-key"] === undefined) {
      await handleOAuthMcp(req, res, oauth);
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404, {
        "content-type": "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Not found",
        })
      );

      return;
    }

    if (!isAuthorized(req)) {
      res.writeHead(401, {
        "content-type": "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Unauthorized",
        })
      );

      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, {
        "content-type": "application/json",
        allow: "POST",
      });

      res.end(
        JSON.stringify({
          error: "Method not allowed",
        })
      );

      return;
    }

    const authorization = parseXeroMcpAuthorization(
      req.headers.authorization,
      req.headers["xero-tenant-id"],
    );
    if (!authorization) {
      sendError(res, 401, "Xero authorization is required.");
      return;
    }

    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
      );
    }

    const bodyText = Buffer.concat(chunks).toString("utf8");

    let body: unknown = undefined;

    if (bodyText) {
      body = JSON.parse(bodyText);
    }

    const server = buildServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    transport.onerror = () => {
      console.error("MCP transport error.");
    };

    await withXeroMcpAuthorization(authorization, async () => {
      res.setHeader("X-ADC-Xero-MCP-Authorization", "request-scoped-v1");
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    });
  } catch (error) {
    console.error("MCP request failed.");
    if (error instanceof XeroMcpAuthorizationError) {
      sendError(res, 403, "Xero authorization for the selected organisation was rejected.");
      return;
    }
    if (error instanceof XeroMcpAuthorizationUnavailableError) {
      sendError(res, 503, "Xero authorization is temporarily unavailable.");
      return;
    }
    sendError(res, 500, "Internal server error.");
    if (!res.writableEnded && res.headersSent) res.end();
  }
});

async function main(): Promise<void> {
  const result = loadOAuthConfig();
  if (result.enabled) {
    try {
      const store = await OAuthStore.open(result.config.storePath);
      const grants = new GrantService(result.config, store);
      oauth = { routes: new OAuthRoutes(grants), grants };
      console.log(`OAuth mode enabled (Xero sign-in at ${result.config.baseUrl}/connect).`);
    } catch (error) {
      console.error(
        `OAuth mode disabled: cannot open token store at ${result.config.storePath} (${(error as Error).message}). Attach a volume to the service.`,
      );
    }
  } else {
    console.log(`OAuth mode disabled; missing: ${result.missing.join(", ")}.`);
  }

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`ADC Findev Xero MCP listening on port ${port}`);
  });
}

main().catch((error) => {
  console.error("Startup failed:", (error as Error).message);
  process.exit(1);
});

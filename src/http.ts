import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ToolFactory } from "./tools/tool-factory.js";

const port = Number(process.env.PORT || 3000);

function isAuthorized(req: http.IncomingMessage): boolean {
  const apiKey = req.headers["x-api-key"];

  return (
    typeof apiKey === "string" &&
    !!process.env.MCP_API_KEY &&
    apiKey === process.env.MCP_API_KEY
  );
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "ADC Findev Xero MCP",
    version: "1.0.0",
  });

  ToolFactory(server);

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  try {
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

    transport.onerror = (error) => {
      console.error("MCP transport error:", error);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("MCP request failed:", error);

    if (!res.headersSent) {
      res.writeHead(500, {
        "content-type": "application/json",
      });
    }

    if (!res.writableEnded) {
      res.end(
        JSON.stringify({
          error: "Internal server error",
        })
      );
    }
  }
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`ADC Findev Xero MCP listening on port ${port}`);
});

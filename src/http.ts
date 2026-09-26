import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { XeroMcpServer } from "./server/xero-mcp-server.js";
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

    if (!bodyText) {
      res.writeHead(400, {
        "content-type": "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Missing request body",
        })
      );

      return;
    }

    let body: unknown;

    try {
      body = JSON.parse(bodyText);
    } catch {
      res.writeHead(400, {
        "content-type": "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Invalid JSON",
        })
      );

      return;
    }

    const mcpServer = XeroMcpServer.GetServer();
    ToolFactory(mcpServer);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);

    await transport.handleRequest(
      req,
      res,
      body
    );
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
  console.log(
    `ADC Findev Xero MCP listening on port ${port}`
  );
});

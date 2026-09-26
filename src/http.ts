import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { XeroMcpServer } from "./server/xero-mcp-server.js";
import { ToolFactory } from "./tools/tool-factory.js";

const port = Number(process.env.PORT || 3000);

const server = XeroMcpServer.GetServer();
ToolFactory(server);

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/mcp") {
    const apiKey = req.headers["x-api-key"];

    if (!process.env.MCP_API_KEY || apiKey !== process.env.MCP_API_KEY) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  if (req.url === "/mcp" && req.method === "POST") {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const bodyText = Buffer.concat(chunks).toString("utf8");

    let body: unknown = undefined;

    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Xero remote MCP listening on port ${port}`);
});

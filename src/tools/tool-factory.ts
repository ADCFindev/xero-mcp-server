import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ToolDefinition } from "../types/tool-definition.js";
import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ToolWrapper = (tool: ToolDefinition<any>) => ToolDefinition<any>;

export function ToolFactory(
  server: McpServer,
  wrap: ToolWrapper = (tool) => tool,
  extraTools: ToolDefinition<any>[] = [],
) {
  const register = (tool: ToolDefinition<any>) =>
    server.tool(tool.name, tool.description, tool.schema, tool.handler);

  [...DeleteTools, ...GetTools, ...CreateTools, ...ListTools, ...UpdateTools]
    .map((tool) => wrap(tool() as ToolDefinition<any>))
    .forEach(register);

  extraTools.forEach(register);
}

import { z } from "zod";

import { withXeroMcpAuthorization } from "../clients/xero-client.js";
import { ToolDefinition } from "../types/tool-definition.js";
import {
  GrantService,
  OrganisationSelectionError,
  ReconnectRequiredError,
  oauthRequestContext,
} from "./grants.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyTool = ToolDefinition<any>;
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ORGANISATION_ARGUMENT = z
  .string()
  .optional()
  .describe(
    "Which Xero organisation (client) to use: its name, e.g. \"Kapow LLC\", or tenant ID. " +
      "Always pass it when more than one organisation is connected; otherwise the default organisation is used.",
  );

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function currentGrantId(): string {
  const context = oauthRequestContext.getStore();
  if (!context) throw new Error("No OAuth request context.");
  return context.grantId;
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof OrganisationSelectionError || error instanceof ReconnectRequiredError) {
    return textResult(error.message, true);
  }
  throw error;
}

/**
 * Adds an optional `organisation` argument to a Xero tool and runs the tool
 * against that organisation with the signed-in user's Xero token.
 */
export function withOrganisation(grants: GrantService) {
  return (tool: AnyTool): AnyTool => {
    const originalHandler = tool.handler as unknown as (args: any, extra: any) => Promise<ToolResult>;
    const handler = async (args: Record<string, unknown> = {}, extra: unknown) => {
      const { organisation, ...rest } = args;
      const grantId = currentGrantId();
      let tenantId: string;
      let accessToken: string;
      try {
        const selected = await grants.resolveOrganisation(
          grantId,
          typeof organisation === "string" ? organisation : undefined,
        );
        tenantId = selected.tenantId;
        accessToken = await grants.getAccessToken(grantId);
      } catch (error) {
        return errorResult(error);
      }
      return withXeroMcpAuthorization({ accessToken, tenantId }, () =>
        originalHandler(rest, extra),
      );
    };
    return {
      ...tool,
      schema: { ...(tool.schema ?? {}), organisation: ORGANISATION_ARGUMENT },
      handler: handler as any,
    };
  };
}

/** Tools for choosing and connecting organisations in OAuth mode. */
export function organisationTools(grants: GrantService): AnyTool[] {
  const listOrganisations: AnyTool = {
    name: "list-organisations",
    description:
      "List the Xero organisations (clients) connected to this connector, with their tenant IDs and which one is the default.",
    schema: {},
    handler: (async () => {
      const grantId = currentGrantId();
      try {
        const connections = await grants.getConnections(grantId);
        if (connections.length === 0) {
          return textResult(`No organisations are connected. Open ${grants.connectUrl} to connect one.`);
        }
        const defaultId = grants.getGrant(grantId)?.defaultTenantId;
        const lines = connections.map(
          (c) => `- ${c.tenantName} (tenant ID: ${c.tenantId})${c.tenantId === defaultId ? " [default]" : ""}`,
        );
        return textResult(
          `Connected organisations (${connections.length}):\n${lines.join("\n")}\n\nTo connect another organisation, open ${grants.connectUrl}.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    }) as any,
  };

  const setDefault: AnyTool = {
    name: "set-default-organisation",
    description:
      "Set the default Xero organisation used when a tool call does not pass the organisation argument.",
    schema: {
      organisation: z.string().describe("Organisation name or tenant ID."),
    },
    handler: (async ({ organisation }: { organisation: string }) => {
      const grantId = currentGrantId();
      try {
        const selected = await grants.resolveOrganisation(grantId, organisation);
        await grants.setDefaultOrganisation(grantId, selected.tenantId);
        return textResult(`Default organisation set to ${selected.tenantName} (${selected.tenantId}).`);
      } catch (error) {
        return errorResult(error);
      }
    }) as any,
  };

  const connectLink: AnyTool = {
    name: "connect-organisation",
    description:
      "Get the link for connecting another Xero organisation (client) to this connector. The user opens it in a browser, signs in to Xero and picks the organisation.",
    schema: {},
    handler: (async () =>
      textResult(
        `Open ${grants.connectUrl} in a browser, sign in to Xero and choose the organisation to connect. Repeat for each client. It will then appear in list-organisations.`,
      )) as any,
  };

  return [listOrganisations, setDefault, connectLink];
}

import type { XeroMcpAuthorizationContext } from "../clients/xero-client.js";

const XERO_TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseXeroMcpAuthorization(
  authorizationHeader: string | string[] | undefined,
  tenantHeader: string | string[] | undefined,
): XeroMcpAuthorizationContext | null {
  if (typeof authorizationHeader !== "string" || typeof tenantHeader !== "string") {
    return null;
  }

  const bearerMatch = /^Bearer (\S{1,8192})$/i.exec(authorizationHeader.trim());
  if (!bearerMatch || !XERO_TENANT_ID_PATTERN.test(tenantHeader)) {
    return null;
  }

  return { accessToken: bearerMatch[1]!, tenantId: tenantHeader };
}
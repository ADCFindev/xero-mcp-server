import path from "node:path";

/**
 * Configuration for the multi-client (Xero Web app) OAuth mode.
 *
 * OAuth mode is enabled only when every required variable is present. When it
 * is disabled the server keeps its original behaviour (x-api-key + caller
 * supplied Xero bearer token + xero-tenant-id header).
 */
export type OAuthConfig = {
  baseUrl: string;
  xeroClientId: string;
  xeroClientSecret: string;
  xeroScopes: string;
  encryptionKey: string;
  allowedEmails: Set<string>;
  storePath: string;
};

// Granular scopes for Xero apps created from 29 Apr 2026 (see README).
const DEFAULT_XERO_SCOPES = [
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.attachments",
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.contacts",
  "accounting.settings",
  "payroll.settings",
  "payroll.employees",
  "payroll.timesheets",
];

const OIDC_SCOPES = ["openid", "profile", "email", "offline_access"];

export function buildScopes(configured: string | undefined): string {
  const scopes = (configured?.trim() ? configured.trim().split(/\s+/) : DEFAULT_XERO_SCOPES)
    .filter(Boolean);
  for (const scope of OIDC_SCOPES) {
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes.join(" ");
}

function resolveBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) return `https://${railwayDomain}`;
  return null;
}

function resolveStorePath(env: NodeJS.ProcessEnv): string {
  if (env.OAUTH_STORE_PATH?.trim()) return env.OAUTH_STORE_PATH.trim();
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || "/data";
  return path.join(volume, "oauth-store.json");
}

export type OAuthConfigResult =
  | { enabled: true; config: OAuthConfig }
  | { enabled: false; missing: string[] };

export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfigResult {
  const missing: string[] = [];
  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) missing.push("PUBLIC_BASE_URL");
  const xeroClientId = env.XERO_CLIENT_ID?.trim();
  if (!xeroClientId) missing.push("XERO_CLIENT_ID");
  const xeroClientSecret = env.XERO_CLIENT_SECRET?.trim();
  if (!xeroClientSecret) missing.push("XERO_CLIENT_SECRET");
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey || encryptionKey.length < 32) missing.push("TOKEN_ENCRYPTION_KEY");
  const allowedEmails = new Set(
    (env.ALLOWED_XERO_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedEmails.size === 0) missing.push("ALLOWED_XERO_EMAILS");

  if (missing.length > 0) return { enabled: false, missing };

  return {
    enabled: true,
    config: {
      baseUrl: baseUrl!,
      xeroClientId: xeroClientId!,
      xeroClientSecret: xeroClientSecret!,
      xeroScopes: buildScopes(env.XERO_SCOPES),
      encryptionKey: encryptionKey!,
      allowedEmails,
      storePath: resolveStorePath(env),
    },
  };
}

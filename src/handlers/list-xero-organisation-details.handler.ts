import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Organisation } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { cachedReference } from "../helpers/reference-cache.js";

async function getOrganisationDetails(): Promise<Organisation> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getOrganisations(
    xeroClient.tenantId,
    getClientHeaders(),
  );

  const organisation = response.body.organisations?.[0];

  if (!organisation) {
    throw new Error("Failed to retrieve organisation details");
  }

  return organisation;
}

/**
 * Organisation details for the current organisation, from the reference cache.
 * Used for the short code in deep links, so creates and updates do not fetch
 * the organisation every time.
 */
export function getCachedOrganisation(
  options: { refresh?: boolean } = {},
): Promise<Organisation> {
  return cachedReference("organisation", null, getOrganisationDetails, options);
}

/**
 * List organisation details from Xero
 */
export async function listXeroOrganisationDetails(
  options: { refresh?: boolean } = {},
): Promise<
  XeroClientResponse<Organisation>
> {
  try {
    const organisation = await getCachedOrganisation(options);

    return {
      result: organisation,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}

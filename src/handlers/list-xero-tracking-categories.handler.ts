import { xeroClient } from "../clients/xero-client.js";
import { TrackingCategory } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { cachedReference } from "../helpers/reference-cache.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

async function getTrackingCategories(
  includeArchived?: boolean
): Promise<TrackingCategory[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getTrackingCategories(
    xeroClient.tenantId, // xeroTenantId
    undefined, // where
    undefined, // order
    includeArchived, // includeArchived
    getClientHeaders()
  );

  return response.body.trackingCategories ?? [];
}

export async function listXeroTrackingCategories(
  includeArchived?: boolean,
  options: { refresh?: boolean } = {},
): Promise<XeroClientResponse<TrackingCategory[]>> {
  try {
    const trackingCategories = await cachedReference(
      "trackingCategories",
      { includeArchived: includeArchived ?? false },
      () => getTrackingCategories(includeArchived),
      options,
    );

    return {
      result: trackingCategories,
      isError: false,
      error: null
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error)
    };
  }
}
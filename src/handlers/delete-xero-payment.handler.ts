import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { PaymentDelete } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function deletePayment(paymentId: string): Promise<boolean> {
  await xeroClient.authenticate();

  const paymentDelete: PaymentDelete = {
    status: PaymentDelete.StatusEnum.DELETED,
  };

  await xeroClient.accountingApi.deletePayment(
    xeroClient.tenantId,
    paymentId,
    paymentDelete,
    undefined,
    getClientHeaders(),
  );

  return true;
}

/**
 * Delete (reverse) an existing payment in Xero.
 */
export async function deleteXeroPayment(
  paymentId: string,
): Promise<XeroClientResponse<boolean>> {
  try {
    await deletePayment(paymentId);

    return {
      result: true,
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

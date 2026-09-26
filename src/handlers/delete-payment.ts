import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Payment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

type DeletePaymentProps = {
  paymentId: string;
};

async function deletePayment({
  paymentId,
}: DeletePaymentProps): Promise<Payment | undefined> {
  await xeroClient.authenticate();

  const payment: Payment = {
    status: Payment.StatusEnum.DELETED,
  };

  const response = await xeroClient.accountingApi.deletePayment(
    xeroClient.tenantId,
    paymentId,
    payment,
    undefined,
    getClientHeaders(),
  );

  return response.body.payments?.[0];
}

/**
 * Delete (reverse) an existing payment in Xero
 */
export async function deleteXeroPayment({
  paymentId,
}: DeletePaymentProps): Promise<XeroClientResponse<Payment>> {
  try {
    const deletedPayment = await deletePayment({
      paymentId,
    });

    if (!deletedPayment) {
      throw new Error("Payment deletion failed.");
    }

    return {
      result: deletedPayment,
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

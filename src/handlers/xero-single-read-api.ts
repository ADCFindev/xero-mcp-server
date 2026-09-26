import axios from "axios";

import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { normalizeXeroOutput } from "../helpers/format-xero-output.js";

type XeroEnvelope = Record<string, unknown>;

async function getAuthHeaders(): Promise<Record<string, string>> {
  await xeroClient.authenticate();

  const tokenSet = xeroClient.readTokenSet();
  const accessToken = tokenSet.access_token;

  if (!accessToken) throw new Error("Xero access token is unavailable.");
  if (!xeroClient.tenantId) throw new Error("Xero tenant ID is unavailable.");

  return {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": xeroClient.tenantId,
    Accept: "application/json",
  };
}

async function getOne(
  resource: string,
  id: string,
  collectionName: string,
): Promise<XeroClientResponse<unknown | null>> {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get<XeroEnvelope>(
      `https://api.xero.com/api.xro/2.0/${resource}/${encodeURIComponent(id)}`,
      { headers },
    );

    const collection = response.data[collectionName];
    const item = Array.isArray(collection) ? collection[0] ?? null : null;

    return {
      result: normalizeXeroOutput(item),
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

export const getXeroInvoice = (invoiceId: string) =>
  getOne("Invoices", invoiceId, "Invoices");

export const getXeroBankTransaction = (bankTransactionId: string) =>
  getOne("BankTransactions", bankTransactionId, "BankTransactions");

export const getXeroPayment = (paymentId: string) =>
  getOne("Payments", paymentId, "Payments");

export const getXeroContact = (contactId: string) =>
  getOne("Contacts", contactId, "Contacts");

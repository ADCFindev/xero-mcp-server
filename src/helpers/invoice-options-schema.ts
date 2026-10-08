import { z } from "zod";

/**
 * Optional invoice header fields shared by the create-invoice and update-invoice tools.
 */
export const invoiceOptionsSchema = {
  invoiceNumber: z.string().optional().describe("The invoice number, e.g. ADC0070. \
    For sales invoices, leave empty to let Xero assign the next number. \
    For bills, this is the supplier's invoice number."),
  currencyCode: z.string().length(3).optional().describe("ISO currency code of the invoice, e.g. GBP, USD, EUR. \
    Defaults to the organisation's base currency. The currency must be enabled in the organisation."),
  currencyRate: z.number().positive().optional().describe("Exchange rate to the base currency \
    (units of invoice currency per 1 unit of base currency). Leave empty to use Xero's daily rate."),
  dueDate: z.string().optional().describe("The due date (YYYY-MM-DD format). Defaults to 30 days from today on create."),
  status: z.enum(["DRAFT", "SUBMITTED", "AUTHORISED"]).optional().describe("Invoice status. \
    DRAFT by default. Use AUTHORISED only when the user has asked to approve the invoice."),
  lineAmountTypes: z.enum(["Exclusive", "Inclusive", "NoTax"]).optional().describe("Whether line amounts \
    are tax exclusive, tax inclusive, or have no tax. Defaults to the organisation's setting (usually Exclusive)."),
};

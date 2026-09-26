import CreateBankTransactionTool from "./create-bank-transaction.tool.js";
import CreateBankTransferTool from "./create-bank-transfer.tool.js";
import AllocatePrepaymentTool from "./allocate-prepayment.tool.js";
import AllocateOverpaymentTool from "./allocate-overpayment.tool.js";
import CreateBatchPaymentTool from "./create-batch-payment.tool.js";
import CreateContactTool from "./create-contact.tool.js";
import CreateCreditNoteTool from "./create-credit-note.tool.js";
import CreateInvoiceTool from "./create-invoice.tool.js";
import CreateItemTool from "./create-item.tool.js";
import CreateManualJournalTool from "./create-manual-journal.tool.js";
import CreatePaymentTool from "./create-payment.tool.js";
import CreatePayrollTimesheetTool from "./create-payroll-timesheet.tool.js";
import CreateQuoteTool from "./create-quote.tool.js";
import CreateTrackingCategoryTool from "./create-tracking-category.tool.js";
import CreateTrackingOptionsTool from "./create-tracking-options.tool.js";

export const CreateTools = [
  CreateContactTool,
  CreateCreditNoteTool,
  CreateManualJournalTool,
  CreateInvoiceTool,
  CreateQuoteTool,
  CreatePaymentTool,
  CreateItemTool,
  CreateBankTransactionTool,
  CreateBankTransferTool,
  AllocatePrepaymentTool,
  AllocateOverpaymentTool,
  CreateBatchPaymentTool,
  CreatePayrollTimesheetTool,
  CreateTrackingCategoryTool,
  CreateTrackingOptionsTool
];

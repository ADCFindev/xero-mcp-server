import { LineItem } from "xero-node";

const formatTracking = (lineItem: LineItem): string | null => {
  if (!lineItem.tracking || lineItem.tracking.length === 0) {
    return null;
  }

  return lineItem.tracking
    .map((tracking) => {
      const name = tracking.name || "Unknown category";
      const option = tracking.option || "Unknown option";
      return `${name}: ${option}`;
    })
    .join(", ");
};

export const formatLineItem = (lineItem: LineItem): string => {
  const tracking = formatTracking(lineItem);

  return [
    `Item ID: ${lineItem.item}`,
    `Item Code: ${lineItem.itemCode}`,
    `Description: ${lineItem.description}`,
    `Quantity: ${lineItem.quantity}`,
    `Unit Amount: ${lineItem.unitAmount}`,
    `Account Code: ${lineItem.accountCode}`,
    `Tax Type: ${lineItem.taxType}`,
    tracking ? `Tracking: ${tracking}` : null,
    `Line Amount: ${lineItem.lineAmount}`,
  ]
    .filter(Boolean)
    .join("\n");
};

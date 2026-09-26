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

const formatItem = (lineItem: LineItem): string[] => {
  if (!lineItem.item) {
    return [];
  }

  return [
    lineItem.item.itemID ? `Item ID: ${lineItem.item.itemID}` : null,
    lineItem.item.code ? `Item Code: ${lineItem.item.code}` : null,
    lineItem.item.name ? `Item Name: ${lineItem.item.name}` : null,
  ].filter((value): value is string => Boolean(value));
};

export const formatLineItem = (lineItem: LineItem): string => {
  const tracking = formatTracking(lineItem);

  return [
    ...formatItem(lineItem),
    !lineItem.item && lineItem.lineItemID
      ? `Line Item ID: ${lineItem.lineItemID}`
      : null,
    lineItem.itemCode ? `Item Code: ${lineItem.itemCode}` : null,
    lineItem.description ? `Description: ${lineItem.description}` : null,
    lineItem.quantity !== undefined ? `Quantity: ${lineItem.quantity}` : null,
    lineItem.unitAmount !== undefined
      ? `Unit Amount: ${lineItem.unitAmount}`
      : null,
    lineItem.accountCode ? `Account Code: ${lineItem.accountCode}` : null,
    lineItem.taxType ? `Tax Type: ${lineItem.taxType}` : null,
    tracking ? `Tracking: ${tracking}` : null,
    lineItem.lineAmount !== undefined
      ? `Line Amount: ${lineItem.lineAmount}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
};

import type { TradeTransaction } from "../../types/models";
import { normalizeTransactionForApplication } from "./financialTransactionType.ts";

export function prepareTransactionForCompletion(input: TradeTransaction): TradeTransaction {
  const normalizedInput = normalizeTransactionForApplication(input);
  const items = normalizedInput.items.map((item) => ({
    ...item,
    inventoryPurchaseId: item.direction === "outgoing" ? item.inventoryPurchaseId : undefined,
    createdInventoryPurchaseId: item.direction === "incoming" ? item.createdInventoryPurchaseId : undefined
  }));
  if (normalizedInput.transactionType === "sale") {
    items.forEach((item) => {
      if (item.direction === "outgoing") item.createdSalesRecordId ||= item.id;
    });
  } else if (normalizedInput.transactionType === "purchase") {
    items.forEach((item) => {
      if (item.direction === "incoming") item.inventoryPurchaseId = undefined;
    });
  } else if (normalizedInput.transactionType === "expense") {
    const expenseItem = items[0];
    if (expenseItem) expenseItem.createdBusinessExpenseId ||= expenseItem.id;
  } else {
    items.forEach((item) => {
      if (item.direction === "incoming") item.inventoryPurchaseId = undefined;
      if (item.direction === "outgoing") item.createdInventoryPurchaseId = undefined;
    });
  }
  return { ...normalizedInput, status: "draft", items };
}

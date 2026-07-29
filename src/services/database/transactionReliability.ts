import type { TradeTransaction } from "../../types/models";
import { normalizeTransactionForApplication } from "./financialTransactionType.ts";

export function prepareTransactionForCompletion(input: TradeTransaction): TradeTransaction {
  const normalizedInput = normalizeTransactionForApplication(input);
  const items = normalizedInput.items.map((item) => ({ ...item }));
  if (normalizedInput.transactionType === "sale") {
    items.forEach((item) => {
      if (item.direction === "outgoing") item.createdSalesRecordId ||= item.id;
    });
  } else if (normalizedInput.transactionType === "purchase") {
    const incoming = items.filter((item) => item.direction === "incoming");
    if (normalizedInput.keepAsBundle && incoming.length > 1) {
      const lotId = incoming.find((item) => item.createdInventoryPurchaseId)?.createdInventoryPurchaseId || incoming[0].id;
      incoming.forEach((item) => { item.createdInventoryPurchaseId = lotId; });
    } else {
      incoming.forEach((item) => { item.createdInventoryPurchaseId ||= item.id; });
    }
  } else if (normalizedInput.transactionType === "expense") {
    const expenseItem = items[0];
    if (expenseItem) expenseItem.createdBusinessExpenseId ||= expenseItem.id;
  } else {
    items.forEach((item) => {
      if (item.direction === "incoming") item.createdInventoryPurchaseId ||= item.id;
    });
  }
  return { ...normalizedInput, status: "draft", items };
}

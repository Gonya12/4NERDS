import type { BusinessExpenseCategory, TradeStatus, TradeTransaction } from "../../types/models";
import {
  mapTransactionTypeToApplicationValue,
  mapTransactionTypeToDatabaseValue,
  type DatabaseFinancialTransactionType,
} from "./financialTransactionType.ts";

export type FinancialTransactionPayload = {
  id: string;
  transaction_type: DatabaseFinancialTransactionType;
  transaction_subtype?: string;
  transaction_date: string;
  event_id?: string;
  event_day_id?: string;
  customer_or_seller?: string;
  payment_method?: TradeTransaction["paymentMethod"];
  cash_received: number;
  cash_paid: number;
  bundle_total?: number;
  allocation_method: TradeTransaction["pricingMode"];
  entered_by_worker_id?: string;
  notes?: string;
  status: TradeStatus;
  item_mode: TradeTransaction["itemMode"];
  general_image_url?: string;
  general_image_path?: string;
  expense_category?: BusinessExpenseCategory;
  completed_at?: string;
  reversed_at?: string;
  created_at: string;
  updated_at: string;
};

function optionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function removeUndefinedFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>
  };
}

export function buildFinancialTransactionPayload(transaction: TradeTransaction): FinancialTransactionPayload {
  const applicationType = mapTransactionTypeToApplicationValue(transaction.transactionType);
  const databaseType = mapTransactionTypeToDatabaseValue(transaction.transactionType);
  const transactionSubtype = applicationType === "purchase"
    ? transaction.purchaseSource
    : applicationType === "expense"
      ? transaction.expenseCategory
      : undefined;
  const common: FinancialTransactionPayload = {
    id: transaction.id,
    transaction_type: databaseType,
    transaction_subtype: optionalText(transactionSubtype),
    transaction_date: transaction.tradeDate,
    event_id: optionalText(transaction.eventId),
    event_day_id: optionalText(transaction.eventDayId),
    customer_or_seller: optionalText(transaction.tradePartner),
    payment_method: transaction.paymentMethod,
    cash_received: Number(transaction.cashReceived || 0),
    cash_paid: Number(transaction.cashPaid || 0),
    bundle_total: transaction.bundleTotal,
    allocation_method: transaction.pricingMode,
    entered_by_worker_id: optionalText(transaction.enteredByWorkerId || transaction.paidByWorkerId),
    notes: optionalText(transaction.notes),
    status: transaction.status,
    item_mode: transaction.itemMode,
    general_image_url: optionalText(transaction.generalImageUrl),
    general_image_path: optionalText(transaction.generalImagePath),
    completed_at: optionalText(transaction.completedAt),
    reversed_at: optionalText(transaction.reversedAt),
    created_at: transaction.createdAt,
    updated_at: transaction.updatedAt
  };
  if (applicationType === "expense" && transaction.expenseCategory) {
    common.expense_category = transaction.expenseCategory;
  }
  return removeUndefinedFields(common) as FinancialTransactionPayload;
}

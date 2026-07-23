import type { BusinessExpense, Event, InventoryPurchase, SalesRecord } from "../types/models";

export type FinancialDateRange = "this_week" | "last_week" | "this_month" | "last_month" | "last_3_months" | "this_year" | "custom";

export const financialDateRangeLabels: Record<FinancialDateRange, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  last_3_months: "Last 3 Months",
  this_year: "This Year",
  custom: "Custom Range"
};

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

export function financialDateBounds(range: FinancialDateRange, customStart: string, customEnd: string) {
  const now = new Date();
  let start: Date;
  let end: Date;
  if (range === "this_week") {
    start = startOfWeek(now);
    end = now;
  } else if (range === "last_week") {
    end = startOfWeek(now);
    end.setMilliseconds(-1);
    start = startOfWeek(end);
  } else if (range === "this_month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = now;
  } else if (range === "last_month") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (range === "last_3_months") {
    start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    end = now;
  } else if (range === "this_year") {
    start = new Date(now.getFullYear(), 0, 1);
    end = now;
  } else {
    start = new Date(`${customStart}T00:00:00`);
    end = new Date(`${customEnd}T23:59:59.999`);
  }
  return { start, end };
}

export function isWithinFinancialRange(value: string | undefined, range: FinancialDateRange, customStart: string, customEnd: string) {
  if (!value) return false;
  const { start, end } = financialDateBounds(range, customStart, customEnd);
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= start && date <= end;
}

export function filterFinancialRecords(sales: SalesRecord[], purchases: InventoryPurchase[], expenses: BusinessExpense[], events: Event[], range: FinancialDateRange, customStart: string, customEnd: string) {
  return {
    sales: sales.filter((sale) => isWithinFinancialRange(sale.soldAt, range, customStart, customEnd)),
    purchases: purchases.filter((purchase) => isWithinFinancialRange(purchase.purchaseDate, range, customStart, customEnd)),
    expenses: expenses.filter((expense) => isWithinFinancialRange(expense.expenseDate, range, customStart, customEnd)),
    events: events.filter((event) => isWithinFinancialRange(event.startDate, range, customStart, customEnd))
  };
}

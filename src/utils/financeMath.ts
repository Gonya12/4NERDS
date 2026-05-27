import type { Event, EventFinance } from "../types/models";
import { roundMoney } from "./paymentMath";

export function calculateEventProfit(event: Event, finance?: EventFinance) {
  const eventCost = roundMoney(event.eventCost || 0);
  const salesRecordTotal = roundMoney((event.salesRecords || []).reduce((sum, sale) => sum + Number(sale.soldPrice || 0), 0));
  const totalSales = roundMoney((finance?.totalSales || 0) + salesRecordTotal);
  const gasCost = roundMoney(finance?.gasCost || 0);
  const foodCost = roundMoney(finance?.foodCost || 0);
  const miscCost = roundMoney(finance?.miscCost || 0);
  const totalExpenses = roundMoney(finance?.totalExpenses || 0);
  const expenses = roundMoney(eventCost + gasCost + foodCost + miscCost + totalExpenses);
  return {
    eventCost,
    totalSales,
    totalExpenses: expenses,
    netProfit: roundMoney(totalSales - expenses)
  };
}

export function checklistProgress(event: Event) {
  const items = event.checklistItems || [];
  const completed = items.filter((item) => item.completed).length;
  const total = items.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0
  };
}

import type { Cell, Sheet } from "write-excel-file/browser";
import type { BusinessExpense, Event, InventoryPurchase, SalesRecord, Worker } from "../../types/models";
import { expenseCategoryLabels, financialOverview, inventoryQuantitySummary, pokemonCategoryLabels, selectedEventCost } from "../../utils/salesControl";

export type ExcelExportScope = "all" | "sales" | "inventory" | "expenses" | "filtered" | "date_range" | "event";

type ExportData = {
  sales: SalesRecord[];
  purchases: InventoryPurchase[];
  expenses: BusinessExpense[];
  events: Event[];
  workers: Worker[];
  scopeLabel: string;
};

const headerStyle = { fontWeight: "bold" as const, textColor: "#FFFFFF", backgroundColor: "#F45D13", alignVertical: "center" as const, height: 28 };
const money = (value: number): Cell => ({ value, type: Number, format: "$#,##0.00" });
const percent = (value: number): Cell => ({ value: value / 100, type: Number, format: "0.0%" });
const date = (value?: string): Cell => value ? { value: new Date(value), type: Date, format: "mmm d, yyyy h:mm AM/PM" } : null;
const text = (value?: string | number): Cell => value === undefined || value === null ? "" : String(value);
const header = (labels: string[]): Cell[] => labels.map((value) => ({ value, type: String, ...headerStyle }));

function workerName(workers: Worker[], id?: string) {
  return workers.find((worker) => worker.id === id)?.name || "";
}

function eventName(events: Event[], id?: string) {
  return events.find((event) => event.id === id)?.name || "";
}

function sheet(sheetName: string, data: Cell[][], widths: number[]): Sheet<Blob> {
  return { sheet: sheetName, data, columns: widths.map((width) => ({ width })), stickyRowsCount: 1, showGridLines: true };
}

function salesSheet(data: ExportData) {
  return sheet("Sales", [
    header(["Date Sold", "Item", "Category", "Quantity", "Sold Price", "Cost Basis", "Gross Profit", "Margin", "Market Value", "Raw Card", "Payment Method", "Sold By", "Event", "Purchase Source", "Notes"]),
    ...data.sales.map((sale) => {
      const grossProfit = Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0);
      const margin = Number(sale.soldPrice || 0) > 0 ? grossProfit / Number(sale.soldPrice) * 100 : 0;
      return [date(sale.soldAt), text(sale.itemName || "Details pending"), text(pokemonCategoryLabels[sale.category || "other_pokemon_product"]), Number(sale.quantity || 1), money(Number(sale.soldPrice || 0)), money(Number(sale.boughtPrice || 0)), money(grossProfit), percent(margin), money(Number(sale.marketValue || 0)), sale.isRawCard, text(sale.paymentMethod), text(workerName(data.workers, sale.soldByWorkerId)), text(eventName(data.events, sale.eventId)), text(sale.purchaseSource), text(sale.notes)];
    })
  ], [20, 30, 22, 10, 15, 15, 15, 12, 15, 11, 16, 16, 28, 18, 36]);
}

function inventorySheet(data: ExportData) {
  return sheet("Inventory", [
    header(["Purchase Date", "Item", "Category", "Original Qty", "Qty Sold", "Qty Remaining", "Status", "Total Cost", "Cost Per Unit", "Realized Revenue", "Realized Cost", "Realized Profit", "Market Value", "Potential Profit", "Purchased By", "Event Purchased At", "Seller", "Notes"]),
    ...data.purchases.map((purchase) => {
      const summary = inventoryQuantitySummary(purchase, data.sales);
      return [date(purchase.purchaseDate), text(purchase.itemName), text(pokemonCategoryLabels[purchase.category]), purchase.quantity, summary.quantitySold, summary.quantityRemaining, text(purchase.status), money(purchase.totalCost), money(summary.costPerUnit), money(summary.realizedRevenue), money(summary.realizedCost), money(summary.realizedProfit), money(Number(purchase.marketValue || 0)), money(summary.potentialProfit), text(workerName(data.workers, purchase.purchasedByWorkerId)), text(eventName(data.events, purchase.eventId)), text(purchase.seller), text(purchase.notes)];
    })
  ], [20, 30, 22, 12, 10, 14, 18, 15, 15, 18, 16, 17, 15, 17, 16, 28, 22, 36]);
}

function expenseSheet(data: ExportData) {
  return sheet("Expenses", [
    header(["Date", "Category", "Description", "Amount", "Event", "Paid By", "Vendor", "Notes"]),
    ...data.expenses.map((expense) => [date(expense.expenseDate), text(expenseCategoryLabels[expense.category]), text(expense.description), money(expense.amount), text(eventName(data.events, expense.eventId)), text(workerName(data.workers, expense.paidByWorkerId)), text(expense.vendor), text(expense.notes)])
  ], [20, 24, 34, 15, 28, 16, 22, 36]);
}

function eventSummarySheet(data: ExportData) {
  const rows = data.events.map((event) => {
    const sales = data.sales.filter((sale) => sale.eventId === event.id);
    const expenses = data.expenses.filter((expense) => expense.eventId === event.id && expense.category !== "event_table_fee");
    const revenue = sales.reduce((sum, sale) => sum + Number(sale.soldPrice || 0), 0);
    const cogs = sales.reduce((sum, sale) => sum + Number(sale.boughtPrice || 0), 0);
    const operating = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const tableCost = selectedEventCost(event);
    return [text(event.name), date(event.startDate), money(revenue), money(cogs), money(revenue - cogs), money(tableCost), money(operating), money(revenue - cogs - tableCost - operating)];
  }).filter((row) => Number((row[2] as { value?: number })?.value || 0) || Number((row[5] as { value?: number })?.value || 0));
  return sheet("Event Summary", [header(["Event", "Date", "Revenue", "COGS", "Gross Profit", "Table Cost", "Other Expenses", "Net Profit"]), ...rows], [32, 20, 15, 15, 17, 15, 18, 16]);
}

function monthlySummarySheet(data: ExportData) {
  const months = new Map<string, { revenue: number; cogs: number; expenses: number; inventory: number }>();
  const get = (key: string) => months.get(key) || { revenue: 0, cogs: 0, expenses: 0, inventory: 0 };
  data.sales.forEach((sale) => { const key = sale.soldAt.slice(0, 7); const row = get(key); row.revenue += Number(sale.soldPrice || 0); row.cogs += Number(sale.boughtPrice || 0); months.set(key, row); });
  data.expenses.forEach((expense) => { const key = expense.expenseDate.slice(0, 7); const row = get(key); row.expenses += Number(expense.amount || 0); months.set(key, row); });
  data.purchases.forEach((purchase) => { const key = purchase.purchaseDate.slice(0, 7); const row = get(key); row.inventory += Number(purchase.totalCost || 0); months.set(key, row); });
  return sheet("Monthly Summary", [
    header(["Month", "Revenue", "COGS", "Gross Profit", "Operating Expenses", "Inventory Purchased", "Net Before Table Costs"]),
    ...Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [text(new Date(`${key}-01T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" })), money(row.revenue), money(row.cogs), money(row.revenue - row.cogs), money(row.expenses), money(row.inventory), money(row.revenue - row.cogs - row.expenses)])
  ], [22, 15, 15, 17, 20, 20, 22]);
}

export async function downloadFinancialWorkbook(data: ExportData) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const overview = financialOverview(data.sales, data.purchases, data.expenses, data.events);
  const overviewSheet = sheet("Overview", [
    [{ value: "4 Nerds Sales & Finance", type: String, fontWeight: "bold", fontSize: 18, textColor: "#F45D13", columnSpan: 2 }],
    ["Export scope", data.scopeLabel],
    ["Generated", { value: new Date(), type: Date, format: "mmm d, yyyy h:mm AM/PM" }],
    ["Total revenue", money(overview.revenue)],
    ["Cost of goods sold", money(overview.costOfGoodsSold)],
    ["Gross profit", money(overview.grossProfit)],
    ["Operating expenses", money(overview.operatingExpenses + overview.eventTableCosts)],
    ["Net profit", money(overview.netProfit)],
    ["Inventory purchased", money(overview.inventoryInvestment)],
    ["Unsold inventory cost", money(overview.unsoldInventoryCost)],
    ["Items sold", overview.itemsSold],
    ["Items in stock", overview.itemsInStock]
  ], [28, 24]);
  const sheets: Sheet<Blob>[] = [overviewSheet, salesSheet(data), inventorySheet(data), expenseSheet(data), eventSummarySheet(data), monthlySummarySheet(data)];
  await writeXlsxFile(sheets).toFile(`4-nerds-finances-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

import type { BusinessExpense, BusinessExpenseCategory, Event, InventoryPurchase, InventoryStatus, OwnershipShare, PokemonProductCategory, PurchaseSource, SalePaymentMethod, SalesRecord } from "../types/models";
import { roundMoney } from "./paymentMath";

export const pokemonCategoryLabels: Record<PokemonProductCategory, string> = {
  raw_card: "Raw Card",
  graded_card: "Graded Card / Slab",
  sealed_product: "Sealed Product",
  pokemon_accessory: "Pokémon Accessory",
  bulk_lot: "Bulk / Lot",
  other_pokemon_product: "Other Pokémon Product"
};

export const purchaseSourceLabels: Record<PurchaseSource, string> = {
  card_show: "Bought at card show",
  online: "Bought online",
  local: "Local purchase",
  trade: "Trade",
  personal_inventory: "Personal inventory",
  other: "Other"
};

export const paymentMethodLabels: Record<SalePaymentMethod, string> = {
  cash: "Cash",
  zelle: "Zelle",
  venmo: "Venmo",
  cash_app: "Cash App",
  paypal: "PayPal",
  card: "Card",
  trade: "Trade",
  other: "Other"
};

export const inventoryStatusLabels: Record<InventoryStatus, string> = {
  in_stock: "In Stock",
  partially_sold: "Partially Sold",
  sold: "Sold",
  personal: "Personal / Not for Sale"
};

export const expenseCategoryLabels: Record<BusinessExpenseCategory, string> = {
  event_table_fee: "Event Table Fee",
  gas: "Gas",
  tolls: "Tolls",
  parking: "Parking",
  food: "Food",
  supplies: "Supplies",
  shipping: "Shipping",
  packaging: "Packaging",
  card_show_equipment: "Card Show Equipment",
  software_subscription: "Software / Subscription",
  advertising: "Advertising",
  other: "Other"
};

export function selectedEventCost(event?: Event) {
  if (!event) return 0;
  return roundMoney((event.priceOptions || []).find((option) => option.isSelected)?.price ?? event.eventCost ?? 0);
}

export function saleProfit(sale: SalesRecord) {
  return roundMoney(Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0));
}

export function inventoryQuantitySummary(purchase: InventoryPurchase, sales: SalesRecord[]) {
  const linkedSales = sales.filter((sale) => sale.inventoryPurchaseId === purchase.id);
  const linkedQuantitySold = linkedSales.reduce((sum, sale) => sum + Number(sale.quantity || 1), 0);
  const quantitySold = Math.min(purchase.quantity, Math.max(Number(purchase.quantitySold || 0), linkedQuantitySold));
  const quantityRemaining = Math.max(0, purchase.quantity - quantitySold);
  const costPerUnit = purchase.quantity > 0 ? roundMoney(purchase.totalCost / purchase.quantity) : 0;
  const realizedCost = roundMoney(costPerUnit * quantitySold);
  const unsoldCost = roundMoney(costPerUnit * quantityRemaining);
  const linkedRevenue = roundMoney(linkedSales.reduce((sum, sale) => sum + Number(sale.soldPrice || 0), 0));
  const realizedRevenue = linkedSales.length ? linkedRevenue : roundMoney(purchase.soldPrice || 0);
  const realizedProfit = roundMoney(realizedRevenue - realizedCost);
  const margin = realizedRevenue > 0 ? roundMoney(realizedProfit / realizedRevenue * 100) : 0;
  const returnOnCost = realizedCost > 0 ? roundMoney(realizedProfit / realizedCost * 100) : 0;
  const potentialProfit = roundMoney(Number(purchase.marketValue || 0) - purchase.totalCost);
  return { linkedSales, quantitySold, quantityRemaining, costPerUnit, realizedCost, unsoldCost, realizedRevenue, realizedProfit, margin, returnOnCost, potentialProfit };
}

export function ownershipTotal(shares?: OwnershipShare[]) {
  return roundMoney((shares || []).reduce((sum, share) => sum + Number(share.ownershipPercentage || 0), 0));
}

export function effectiveSaleOwnership(sale: SalesRecord, purchases: InventoryPurchase[]) {
  return sale.inventoryPurchaseId
    ? purchases.find((purchase) => purchase.id === sale.inventoryPurchaseId)?.ownershipShares || []
    : sale.ownershipShares || [];
}

export function ownerAllocation(amount: number, shares?: OwnershipShare[]) {
  return (shares || []).map((share) => ({ ...share, amount: roundMoney(amount * share.ownershipPercentage / 100) }));
}

export function ownerProfitRows(sales: SalesRecord[], purchases: InventoryPurchase[]) {
  const totals = new Map<string, { profit: number; revenue: number; itemsSold: number }>();
  sales.forEach((sale) => {
    const shares = effectiveSaleOwnership(sale, purchases);
    const profit = saleProfit(sale);
    shares.forEach((share) => {
      const current = totals.get(share.workerId) || { profit: 0, revenue: 0, itemsSold: 0 };
      const ratio = share.ownershipPercentage / 100;
      totals.set(share.workerId, {
        profit: roundMoney(current.profit + profit * ratio),
        revenue: roundMoney(current.revenue + Number(sale.soldPrice || 0) * ratio),
        itemsSold: current.itemsSold + Number(sale.quantity || 1) * ratio
      });
    });
  });
  return totals;
}

export function inventoryStatusForQuantity(quantity: number, quantitySold: number, personal = false): InventoryStatus {
  if (personal) return "personal";
  if (quantitySold <= 0) return "in_stock";
  return quantitySold >= quantity ? "sold" : "partially_sold";
}

export function financialOverview(sales: SalesRecord[], purchases: InventoryPurchase[], expenses: BusinessExpense[], events: Event[]) {
  const purchasesWithoutLinkedSales = purchases.filter((purchase) => !sales.some((sale) => sale.inventoryPurchaseId === purchase.id));
  const directInventoryRevenue = purchasesWithoutLinkedSales.reduce((sum, purchase) => sum + inventoryQuantitySummary(purchase, sales).realizedRevenue, 0);
  const directInventoryCost = purchasesWithoutLinkedSales.reduce((sum, purchase) => sum + inventoryQuantitySummary(purchase, sales).realizedCost, 0);
  const revenue = roundMoney(sales.reduce((sum, sale) => sum + Number(sale.soldPrice || 0), 0) + directInventoryRevenue);
  const costOfGoodsSold = roundMoney(sales.reduce((sum, sale) => sum + Number(sale.boughtPrice || 0), 0) + directInventoryCost);
  const grossProfit = roundMoney(revenue - costOfGoodsSold);
  const inventoryInvestment = roundMoney(purchases.reduce((sum, purchase) => sum + Number(purchase.totalCost || 0), 0));
  const unsoldInventoryCost = roundMoney(purchases.reduce((sum, purchase) => sum + inventoryQuantitySummary(purchase, sales).unsoldCost, 0));
  const eventCostMap = new Map(events.map((event) => [event.id, selectedEventCost(event)]));
  const eventTableCosts = roundMoney(events.reduce((sum, event) => sum + selectedEventCost(event), 0));
  const duplicateTableExpenses = expenses.filter((expense) => expense.category === "event_table_fee" && expense.eventId && Number(eventCostMap.get(expense.eventId) || 0) > 0);
  const operatingExpenses = roundMoney(expenses.reduce((sum, expense) => {
    const duplicatesEventCost = expense.category === "event_table_fee" && expense.eventId && Number(eventCostMap.get(expense.eventId) || 0) > 0;
    return sum + (duplicatesEventCost ? 0 : Number(expense.amount || 0));
  }, 0));
  const netProfit = roundMoney(grossProfit - eventTableCosts - operatingExpenses);
  const itemsSold = sales.reduce((sum, sale) => sum + Number(sale.quantity || 1), 0) + purchasesWithoutLinkedSales.reduce((sum, purchase) => sum + inventoryQuantitySummary(purchase, sales).quantitySold, 0);
  const itemsInStock = purchases.reduce((sum, purchase) => sum + inventoryQuantitySummary(purchase, sales).quantityRemaining, 0);
  return { revenue, costOfGoodsSold, grossProfit, inventoryInvestment, unsoldInventoryCost, eventTableCosts, operatingExpenses, netProfit, itemsSold, itemsInStock, duplicateTableExpenses };
}

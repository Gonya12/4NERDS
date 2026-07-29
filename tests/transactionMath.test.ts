import assert from "node:assert/strict";
import test from "node:test";
import type { TradeItem, TradeTransaction } from "../src/types/models.ts";
import { allocateTransactionTotal, dailyFinancialSummary, transactionReview } from "../src/utils/transactionMath.ts";

const now = "2026-07-29T12:00:00.000Z";
const item = (name: string, market: number, basis: number, owner = "gonzalo"): TradeItem => ({
  id: crypto.randomUUID(), tradeTransactionId: crypto.randomUUID(), direction: "outgoing", itemName: name,
  itemType: "raw_card", quantity: 1, marketValue: market, agreedTradeValue: 0, historicalCostBasis: basis,
  allocatedCostBasis: 0, ownershipShares: [{ workerId: owner, ownershipPercentage: 100 }], createdAt: now, updatedAt: now
});
const transaction = (items: TradeItem[]): TradeTransaction => ({
  id: crypto.randomUUID(), tradeDate: now, transactionType: "sale", itemMode: "multiple", pricingMode: "bundle_total",
  bundleTotal: 100, cashReceived: 0, cashPaid: 0, status: "draft", createdAt: now, updatedAt: now, items
});

test("bundle allocation equals the exact transaction total", () => {
  const rows = allocateTransactionTotal([item("A", 20, 10), item("B", 30, 10), item("C", 50, 20)], 100, "market", "soldPrice");
  assert.equal(rows.reduce((sum, row) => sum + Number(row.soldPrice), 0), 100);
  assert.deepEqual(rows.map((row) => row.soldPrice), [20, 30, 50]);
});

test("owner profit is calculated per item ownership", () => {
  const first = { ...item("A", 50, 20, "gonzalo"), soldPrice: 50 };
  const second = { ...item("B", 50, 30, "thiago"), soldPrice: 50 };
  const review = transactionReview({ ...transaction([first, second]), pricingMode: "individual" });
  assert.equal(review.grossProfit, 50);
  assert.equal(review.ownerProfit.get("gonzalo"), 30);
  assert.equal(review.ownerProfit.get("thiago"), 20);
});

test("bundle profit stays incomplete until every cost basis is known", () => {
  const first = { ...item("Item A", 20, 8, "thiago"), soldPrice: 20 };
  const second = { ...item("Item B", 10, 0, "thiago"), soldPrice: 10 };
  const pending = transactionReview({ ...transaction([first, second]), bundleTotal: 30 });
  assert.equal(pending.sold, 30);
  assert.equal(pending.basisComplete, false);
  assert.equal(pending.grossProfit, undefined);
  assert.equal(pending.ownerProfit.size, 0);
  assert.deepEqual(pending.missingCostBasisItems.map((row) => row.itemName), ["Item B"]);

  const fixed = transactionReview({ ...transaction([first, { ...second, historicalCostBasis: 4 }]), bundleTotal: 30 });
  assert.equal(fixed.basisComplete, true);
  assert.equal(fixed.basis, 12);
  assert.equal(fixed.grossProfit, 18);
  assert.equal(fixed.ownerProfit.get("thiago"), 18);
});

test("zero cost basis is accepted only after explicit confirmation", () => {
  const unconfirmed = { ...item("Promo", 10, 0, "thiago"), soldPrice: 10 };
  assert.equal(transactionReview(transaction([unconfirmed])).basisComplete, false);
  const confirmed = { ...unconfirmed, zeroCostBasisConfirmed: true };
  const review = transactionReview(transaction([confirmed]));
  assert.equal(review.basisComplete, true);
  assert.equal(review.grossProfit, 10);
});

test("purchase payer and item owner produce an unsettled balance suggestion", () => {
  const incoming = { ...item("Lot card", 100, 0, "gonzalo"), direction: "incoming" as const, boughtPrice: 100 };
  const purchase: TradeTransaction = { ...transaction([incoming]), transactionType: "purchase", paidByWorkerId: "thiago" };
  const review = transactionReview(purchase);
  assert.deepEqual(review.internalBalances, [{ owedByWorkerId: "gonzalo", owedToWorkerId: "thiago", amount: 100 }]);
});

test("daily summary excludes trade market value from cash revenue", () => {
  const outgoing = { ...item("A", 100, 40), agreedTradeValue: 80 };
  const incoming = { ...item("B", 100, 0), direction: "incoming" as const, agreedTradeValue: 80, allocatedCostBasis: 40 };
  const trade: TradeTransaction = { ...transaction([outgoing, incoming]), transactionType: "cash_trade", status: "completed", cashReceived: 50, bundleTotal: undefined };
  const summary = dailyFinancialSummary("2026-07-29", [], [], [], [trade]);
  assert.equal(summary.cashSales, 0);
  assert.equal(summary.tradeCashReceived, 50);
  assert.equal(summary.netCashFlow, 50);
});

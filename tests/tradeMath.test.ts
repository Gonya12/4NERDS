import assert from "node:assert/strict";
import test from "node:test";
import type { TradeItem, TradeTransaction } from "../src/types/models.ts";
import { allocateBasis, normalizeTradeAccounting, ownershipIsValid, tradeGainByIncomingItem, tradeGainOwnership, tradeSummary } from "../src/utils/tradeMath.ts";

const item = (direction: "outgoing" | "incoming", name: string, agreed: number, market: number, basis: number): TradeItem => ({
  id: crypto.randomUUID(), tradeTransactionId: "00000000-0000-0000-0000-000000000001", direction,
  itemName: name, itemType: "raw_card", quantity: 1, marketValue: market, agreedTradeValue: agreed,
  historicalCostBasis: direction === "outgoing" ? basis : 0, costBasis: direction === "incoming" ? basis : 0,
  ownershipShares: [{ workerId: "00000000-0000-0000-0000-000000000002", ownershipPercentage: 100 }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
});
const trade = (items: TradeItem[], cashPaid = 0, cashReceived = 0): TradeTransaction => ({
  id: crypto.randomUUID(), tradeDate: new Date().toISOString(), cashPaid, cashReceived, status: "draft",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items
});

test("basic trade keeps value differences separate from cash", () => {
  const summary = tradeSummary(trade([item("outgoing", "Pikachu", 30, 30, 20), item("incoming", "Charizard", 40, 40, 20)]));
  assert.equal(summary.agreedDifference, 10);
  assert.equal(summary.marketDifference, 10);
  assert.equal(summary.cashDifference, 0);
  assert.equal(summary.cashReceived, 0);
});

test("cash adjustment is counted once as trade cash", () => {
  const summary = tradeSummary(trade([item("outgoing", "Card A", 80, 80, 50), item("incoming", "Card B", 100, 100, 70)], 20, 0));
  assert.equal(summary.agreedDifference, 0);
  assert.equal(summary.cashDifference, -20);
  assert.equal(summary.cashPaid, 20);
});

test("multi-item basis allocation totals exactly with rounding", () => {
  const incoming = [item("incoming", "A", 20, 20, 0), item("incoming", "B", 30, 30, 0), item("incoming", "C", 50, 50, 0)];
  const allocated = allocateBasis(73.37, incoming, "market");
  assert.equal(allocated.reduce((sum, row) => sum + row.costBasis, 0), 73.37);
});

test("ownership requires exactly one hundred percent", () => {
  const valid = item("incoming", "A", 10, 10, 5);
  assert.equal(ownershipIsValid(valid), true);
  assert.equal(ownershipIsValid({ ...valid, ownershipShares: [{ ...valid.ownershipShares[0], ownershipPercentage: 99.9 }] }), false);
});

test("Dragonite for Pikachu recognizes trade gain and resets incoming basis to fair value", () => {
  const dragonite = item("outgoing", "Dragonite-EX", 63, 63, 48.98);
  const pikachu = item("incoming", "Pikachu ex", 63, 63, 0);
  const transaction = { ...trade([dragonite, pikachu]), transactionType: "trade" as const };
  const normalized = normalizeTradeAccounting(transaction);
  const summary = tradeSummary(normalized);
  assert.equal(summary.tradeGainLoss, 14.02);
  assert.equal(normalized.items.find((row) => row.direction === "incoming")?.costBasis, 63);
  assert.equal(normalized.items.find((row) => row.direction === "incoming")?.boughtPrice, 0);
  assert.equal(tradeGainOwnership(normalized).get(dragonite.ownershipShares[0].workerId), 14.02);
  assert.equal(tradeGainByIncomingItem(normalized).get(pikachu.id), 14.02);
  assert.equal(70 - Number(normalized.items.find((row) => row.direction === "incoming")?.costBasis), 7);
});

test("cash paid and received are each counted once in realized trade gain", () => {
  const outgoing = item("outgoing", "A", 50, 50, 40);
  const incoming = item("incoming", "B", 55, 55, 0);
  assert.equal(tradeSummary(trade([outgoing, incoming], 10, 0)).tradeGainLoss, 5);
  assert.equal(tradeSummary(trade([outgoing, incoming], 0, 10)).tradeGainLoss, 25);
});

test("trade gain follows outgoing ownership independently of incoming ownership", () => {
  const outgoing = {
    ...item("outgoing", "Shared card", 63, 63, 48.98),
    ownershipShares: [
      { workerId: "owner-a", ownershipPercentage: 50 },
      { workerId: "owner-b", ownershipPercentage: 50 }
    ]
  };
  const incoming = {
    ...item("incoming", "Received card", 63, 63, 0),
    ownershipShares: [{ workerId: "owner-c", ownershipPercentage: 100 }]
  };
  const ownership = tradeGainOwnership(normalizeTradeAccounting({ ...trade([outgoing, incoming]), transactionType: "trade" }));
  assert.equal(ownership.get("owner-a"), 7.01);
  assert.equal(ownership.get("owner-b"), 7.01);
  assert.equal(ownership.has("owner-c"), false);
});

test("multi-item incoming bases and gain allocations total exactly to the cent", () => {
  const outgoing = item("outgoing", "A", 50, 50, 40);
  const incoming = [
    item("incoming", "B", 20, 20, 0),
    item("incoming", "C", 20, 20, 0),
    item("incoming", "D", 23.01, 23.01, 0)
  ];
  const transaction = normalizeTradeAccounting({ ...trade([outgoing, ...incoming]), transactionType: "trade" });
  assert.equal(Math.round(transaction.items.filter((row) => row.direction === "incoming").reduce((sum, row) => sum + row.costBasis, 0) * 100) / 100, 63.01);
  assert.equal(Math.round(Array.from(tradeGainByIncomingItem(transaction).values()).reduce((sum, value) => sum + value, 0) * 100) / 100, 23.01);
});

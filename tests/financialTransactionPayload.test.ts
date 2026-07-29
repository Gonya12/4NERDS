import assert from "node:assert/strict";
import test from "node:test";
import type { TradeTransaction } from "../src/types/models.ts";
import { buildFinancialTransactionPayload } from "../src/services/database/financialTransactionPayload.ts";
import {
  InvalidFinancialTransactionTypeError,
  mapTransactionTypeToApplicationValue,
  mapTransactionTypeToDatabaseValue,
  normalizeTransactionForApplication,
  transactionTypeDeveloperDebug,
} from "../src/services/database/financialTransactionType.ts";

const now = "2026-07-29T12:00:00.000Z";
function transaction(
  transactionType: TradeTransaction["transactionType"],
  patch: Partial<TradeTransaction> = {}
): TradeTransaction {
  return {
    id: "5a88d735-8e67-4d9d-a251-1ba266fa5e34",
    transactionType,
    tradeDate: now,
    itemMode: "multiple",
    pricingMode: "individual",
    cashReceived: 0,
    cashPaid: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    items: [],
    ...patch
  };
}

const allowedKeys = new Set([
  "id", "transaction_type", "transaction_subtype", "transaction_date", "event_id", "event_day_id",
  "customer_or_seller", "payment_method", "cash_received", "cash_paid", "bundle_total",
  "allocation_method", "entered_by_worker_id", "notes", "status", "item_mode",
  "general_image_url", "general_image_path", "expense_category", "completed_at",
  "reversed_at", "created_at", "updated_at"
]);

function assertCleanPayload(payload: ReturnType<typeof buildFinancialTransactionPayload>) {
  assert.ok(Object.keys(payload).every((key) => allowedKeys.has(key)), `Unexpected key: ${Object.keys(payload).find((key) => !allowedKeys.has(key))}`);
  assert.ok(Object.values(payload).every((value) => value !== undefined && value !== null));
}

for (const source of ["pasted", "gallery", "camera"]) {
  test(`multi-item sale with ${source} image omits expense fields and preserves its UUID`, () => {
    const input = transaction("sale", {
      expenseCategory: "event_table_fee",
      generalImageUrl: `https://example.test/${source}.jpg`,
      generalImagePath: `shared/${source}.jpg`
    });
    const payload = buildFinancialTransactionPayload(input);
    assert.equal(payload.id, input.id);
    assert.equal(payload.transaction_type, "sold");
    assert.equal(payload.item_mode, "multiple");
    assert.equal(payload.general_image_path, `shared/${source}.jpg`);
    assert.ok(!("expense_category" in payload));
    assertCleanPayload(payload);
  });
}

test("single-item transaction uses canonical item_mode without entry_mode", () => {
  const payload = buildFinancialTransactionPayload(transaction("sale", { itemMode: "single" }));
  assert.equal(payload.transaction_type, "sold");
  assert.equal(payload.item_mode, "single");
  assert.ok(!("entry_mode" in payload));
  assertCleanPayload(payload);
});

test("inventory lot purchase includes its subtype but not expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("purchase", {
    purchaseSource: "card_show",
    expenseCategory: "other",
    bundleTotal: 500
  }));
  assert.equal(payload.transaction_type, "purchased");
  assert.equal(payload.transaction_subtype, "card_show");
  assert.ok(!("expense_category" in payload));
  assertCleanPayload(payload);
});

test("general expense includes expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("expense", { expenseCategory: "other", cashPaid: 75 }));
  assert.equal(payload.transaction_type, "cost");
  assert.equal(payload.expense_category, "other");
  assertCleanPayload(payload);
});

test("event table fee includes its expense category", () => {
  const payload = buildFinancialTransactionPayload(transaction("expense", { expenseCategory: "event_table_fee", cashPaid: 250 }));
  assert.equal(payload.transaction_type, "cost");
  assert.equal(payload.expense_category, "event_table_fee");
  assertCleanPayload(payload);
});

test("trade omits expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("trade", { expenseCategory: "supplies" }));
  assert.equal(payload.transaction_type, "trade");
  assert.ok(!("expense_category" in payload));
  assertCleanPayload(payload);
});

test("cash + trade omits expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("cash_trade", { expenseCategory: "food", cashPaid: 25, cashReceived: 10 }));
  assert.equal(payload.transaction_type, "cash_trade");
  assert.ok(!("expense_category" in payload));
  assertCleanPayload(payload);
});

test("all UI labels map to exactly the five canonical database values", () => {
  const cases = new Map<string, string>([
    ["sale", "sold"],
    ["sold", "sold"],
    ["multi_sale", "sold"],
    ["multi-item sale", "sold"],
    ["bundle sale", "sold"],
    ["purchase", "purchased"],
    ["purchased", "purchased"],
    ["inventory_purchase", "purchased"],
    ["lot purchase", "purchased"],
    ["expense", "cost"],
    ["business expense", "cost"],
    ["table fee", "cost"],
    ["event cost", "cost"],
    ["trade", "trade"],
    ["multi-item trade", "trade"],
    ["cash + trade", "cash_trade"],
    ["cash+trade", "cash_trade"],
    ["mixed trade", "cash_trade"],
    ["partial trade", "cash_trade"],
    ["multi-item cash + trade", "cash_trade"],
  ]);
  for (const [input, expected] of cases) {
    assert.equal(mapTransactionTypeToDatabaseValue(input), expected, input);
  }
  assert.deepEqual(
    [...new Set([...cases.keys()].map(mapTransactionTypeToDatabaseValue))].sort(),
    ["cash_trade", "cost", "purchased", "sold", "trade"],
  );
});

test("single and multiple workflow payloads keep type, subtype, and item mode separate", () => {
  const workflows = [
    { label: "single sale", type: "sale", mode: "single", expected: "sold" },
    { label: "multi-item sale", type: "multi-item sale", mode: "multiple", expected: "sold" },
    { label: "single purchase", type: "purchase", mode: "single", expected: "purchased" },
    { label: "purchase lot", type: "lot purchase", mode: "multiple", expected: "purchased" },
    { label: "general expense", type: "business expense", mode: "single", expected: "cost" },
    { label: "table fee", type: "table fee", mode: "single", expected: "cost" },
    { label: "trade", type: "trade", mode: "single", expected: "trade" },
    { label: "multi-item trade", type: "multi-item trade", mode: "multiple", expected: "trade" },
    { label: "cash + trade", type: "cash + trade", mode: "single", expected: "cash_trade" },
    { label: "multi-item cash + trade", type: "multi-item cash + trade", mode: "multiple", expected: "cash_trade" },
  ] as const;
  for (const workflow of workflows) {
    const input = transaction("sale", {
      itemMode: workflow.mode,
      purchaseSource: "card_show",
      expenseCategory: "event_table_fee",
    });
    (input as TradeTransaction & { transactionType: string }).transactionType = workflow.type;
    const payload = buildFinancialTransactionPayload(input);
    assert.equal(payload.transaction_type, workflow.expected, workflow.label);
    assert.equal(payload.item_mode, workflow.mode, workflow.label);
    assert.notEqual(payload.transaction_type, payload.transaction_subtype, workflow.label);
  }
});

test("restored local drafts normalize aliases without changing their UUID", () => {
  const restored = transaction("sale", { itemMode: "multiple" });
  (restored as TradeTransaction & { transactionType: string }).transactionType = "bundle sale";
  const normalized = normalizeTransactionForApplication(restored);
  assert.equal(normalized.id, restored.id);
  assert.equal(normalized.transactionType, "sale");
  assert.equal(mapTransactionTypeToApplicationValue("purchased"), "purchase");
  const payload = buildFinancialTransactionPayload(normalized);
  assert.equal(payload.id, restored.id);
  assert.equal(payload.transaction_type, "sold");
  assert.equal(payload.item_mode, "multiple");
});

test("unknown transaction types are rejected before a database payload exists", () => {
  assert.throws(
    () => mapTransactionTypeToDatabaseValue("collection_lot"),
    InvalidFinancialTransactionTypeError,
  );
  const input = transaction("sale");
  (input as TradeTransaction & { transactionType: string }).transactionType = "item_mode_multiple";
  let caught: unknown;
  try {
    buildFinancialTransactionPayload(input);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof InvalidFinancialTransactionTypeError);
  assert.match(transactionTypeDeveloperDebug(caught) || "", /item_mode_multiple/);
  assert.match(transactionTypeDeveloperDebug(caught) || "", /sold, purchased, cost, trade, cash_trade/);
});

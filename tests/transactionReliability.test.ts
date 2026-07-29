import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TradeItem, TradeTransaction } from "../src/types/models.ts";
import {
  buildTransactionImagePayload,
  buildTransactionItemPayload,
  buildTransactionPaymentPayload,
  buildTransactionPaymentPayloads
} from "../src/services/database/databasePayloads.ts";
import { prepareTransactionForCompletion } from "../src/services/database/transactionReliability.ts";
import { ownershipValidationError } from "../src/utils/tradeMath.ts";

const timestamp = "2026-07-29T12:00:00.000Z";

function item(id: string, direction: TradeItem["direction"]): TradeItem {
  return {
    id,
    tradeTransactionId: "10000000-0000-4000-8000-000000000000",
    direction,
    itemName: id,
    itemType: "raw_card",
    quantity: 1,
    marketValue: 10,
    agreedTradeValue: 10,
    historicalCostBasis: 4,
    allocatedCostBasis: 4,
    ownershipShares: [{ workerId: "20000000-0000-4000-8000-000000000000", ownershipPercentage: 100 }],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function transaction(type: TradeTransaction["transactionType"], items: TradeItem[]): TradeTransaction {
  return {
    id: "10000000-0000-4000-8000-000000000000",
    transactionType: type,
    itemMode: items.length > 1 ? "multiple" : "single",
    pricingMode: "individual",
    tradeDate: timestamp,
    cashPaid: 0,
    cashReceived: 0,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    items
  };
}

test("completion materialization IDs are deterministic and survive Retry", () => {
  const sale = prepareTransactionForCompletion(transaction("sale", [item("30000000-0000-4000-8000-000000000001", "outgoing")]));
  assert.equal(sale.items[0].createdSalesRecordId, sale.items[0].id);
  assert.deepEqual(prepareTransactionForCompletion(sale), sale);

  const purchase = prepareTransactionForCompletion(transaction("purchase", [
    item("30000000-0000-4000-8000-000000000002", "incoming"),
    item("30000000-0000-4000-8000-000000000003", "incoming")
  ]));
  assert.equal(purchase.items[0].createdInventoryPurchaseId, purchase.items[0].id);
  assert.equal(purchase.items[1].createdInventoryPurchaseId, purchase.items[1].id);

  const lot = prepareTransactionForCompletion({
    ...transaction("purchase", [
      item("30000000-0000-4000-8000-000000000004", "incoming"),
      item("30000000-0000-4000-8000-000000000005", "incoming")
    ]),
    keepAsBundle: true
  });
  assert.equal(lot.items[0].createdInventoryPurchaseId, lot.items[1].createdInventoryPurchaseId);
  assert.deepEqual(prepareTransactionForCompletion(lot), lot);

  const expense = prepareTransactionForCompletion(transaction("expense", [item("30000000-0000-4000-8000-000000000006", "expense")]));
  assert.equal(expense.items[0].createdBusinessExpenseId, expense.items[0].id);
});

test("item payload allowlist persists cost confirmation and Pokemon pricing fields", () => {
  const source = {
    ...item("30000000-0000-4000-8000-000000000007", "outgoing"),
    zeroCostBasisConfirmed: true,
    cardSetId: "sv4",
    cardSetCode: "PAR",
    cardRarity: "Illustration Rare",
    cardLanguage: "English",
    pokemonTcgCardId: "sv4-200",
    officialCardImageUrl: "https://images.example/card.png",
    tcgplayerUrl: "https://www.tcgplayer.com/product/1",
    marketPriceSource: "tcgplayer",
    marketPriceVariant: "normal.market",
    tcgplayerPricing: { normal: { market: 12.34 } },
    targetBuyPercentage: 70,
    targetBuyPrice: 8.64,
    cardSelectionSource: "inventory" as const
  };
  const payload = buildTransactionItemPayload(source);
  assert.equal(payload.zero_cost_basis_confirmed, true);
  assert.equal(payload.card_set_id, "sv4");
  assert.equal(payload.tcgplayer_url, source.tcgplayerUrl);
  assert.deepEqual(payload.tcgplayer_pricing, source.tcgplayerPricing);
  assert.equal(payload.target_buy_price, 8.64);
  assert.equal("entry_mode" in payload, false);
});

test("ownership validation rejects duplicates and accepts one exact 100 percent share", () => {
  const valid = item("30000000-0000-4000-8000-000000000008", "incoming");
  assert.equal(ownershipValidationError(valid), "");
  const duplicate = {
    ...valid,
    ownershipShares: [
      { workerId: "20000000-0000-4000-8000-000000000000", ownershipPercentage: 50 },
      { workerId: "20000000-0000-4000-8000-000000000000", ownershipPercentage: 50 }
    ]
  };
  assert.match(ownershipValidationError(duplicate), /same worker/i);
});

test("reconciliation migration is additive and uses only canonical transaction tables", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260729120000_unified_transaction_reconciliation.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\b(drop\s+table|truncate\s+table|drop\s+column)\b/i);
  assert.doesNotMatch(sql, /\b(add\s+column\s+(?:if\s+not\s+exists\s+)?entry_mode|create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(?:trade_transactions|trade_items|sales_transactions|purchase_transactions|multi_sale_items))\b/i);
  for (const table of [
    "financial_transactions",
    "financial_transaction_items",
    "transaction_item_ownership_shares",
    "transaction_payments",
    "transaction_internal_balances",
    "inventory_lineage",
    "transaction_images"
  ]) {
    assert.match(sql, new RegExp(`public\\.${table}\\b`));
  }
  assert.match(sql, /notify\s+pgrst,\s*'reload schema'/i);
});

test("transaction image payload is allowlisted and leaves timestamps to the database", () => {
  const payload = buildTransactionImagePayload({
    id: "30000000-0000-4000-8000-000000000000",
    transactionId: "10000000-0000-4000-8000-000000000000",
    imageType: "general",
    imageUrl: "https://example.com/transaction.jpg",
    imagePath: "transaction/shared/general.jpg",
    sortOrder: 2,
    metadataStatus: "pending",
    metadataError: "not a database field",
    reusedFromImageId: "40000000-0000-4000-8000-000000000000"
  }, "fallback", "10000000-0000-4000-8000-000000000000");
  assert.deepEqual(Object.keys(payload).sort(), [
    "id",
    "image_path",
    "image_type",
    "image_url",
    "sort_order",
    "transaction_id",
    "transaction_item_id"
  ]);
  assert.equal(payload.transaction_item_id, null);
  assert.throws(() => buildTransactionImagePayload({
    id: "30000000-0000-4000-8000-000000000000",
    transactionId: "10000000-0000-4000-8000-000000000000",
    imageType: "front",
    imageUrl: "https://example.com/front.jpg",
    imagePath: "transaction/item/front.jpg",
    sortOrder: 0
  }, "fallback", "10000000-0000-4000-8000-000000000000"), /transaction_item_id/);
});

test("transaction payment payload uses the canonical worker column and exact allowlist", () => {
  const payload = buildTransactionPaymentPayload({
    transactionId: "10000000-0000-4000-8000-000000000000",
    direction: "paid",
    paymentMethod: "cash",
    amount: 25,
    paidByWorkerId: "",
    note: "  collection lot  ",
    paidAt: timestamp
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "amount",
    "direction",
    "note",
    "paid_at",
    "paid_by_worker_id",
    "payment_method",
    "transaction_id"
  ]);
  assert.equal(payload.paid_by_worker_id, null);
  assert.equal(payload.note, "collection lot");
  assert.equal("worker_id" in payload, false);
  assert.equal("updated_at" in payload, false);
  assert.throws(() => buildTransactionPaymentPayload({
    transactionId: " ",
    direction: "paid",
    paymentMethod: "cash",
    amount: 1,
    paidAt: timestamp
  }), /transaction_id/);
});

test("payment rows cover purchases, sales, and both cash-trade directions without zero-dollar drafts", () => {
  const transactionId = "10000000-0000-4000-8000-000000000000";
  const gonzalo = "20000000-0000-4000-8000-000000000001";
  const thiago = "20000000-0000-4000-8000-000000000002";
  const base = transaction("purchase", []);

  const unassignedPurchase = buildTransactionPaymentPayloads(transactionId, {
    ...base, cashPaid: 40, paidByWorkerId: undefined
  });
  assert.equal(unassignedPurchase.length, 1);
  assert.equal(unassignedPurchase[0].direction, "paid");
  assert.equal(unassignedPurchase[0].paid_by_worker_id, null);

  const gonzaloPurchase = buildTransactionPaymentPayloads(transactionId, {
    ...base, cashPaid: 40, paidByWorkerId: gonzalo
  });
  assert.equal(gonzaloPurchase[0].paid_by_worker_id, gonzalo);

  const thiagoLot = buildTransactionPaymentPayloads(transactionId, {
    ...base, itemMode: "multiple", cashPaid: 75, paidByWorkerId: thiago
  });
  assert.equal(thiagoLot.length, 1);
  assert.equal(thiagoLot[0].paid_by_worker_id, thiago);

  const cashSale = buildTransactionPaymentPayloads(transactionId, {
    ...transaction("sale", []), cashReceived: 30
  });
  assert.deepEqual(cashSale.map((row) => row.direction), ["received"]);
  assert.equal(cashSale[0].paid_by_worker_id, null);

  const cashTrade = buildTransactionPaymentPayloads(transactionId, {
    ...transaction("cash_trade", []), cashPaid: 12, cashReceived: 8, paidByWorkerId: gonzalo
  });
  assert.deepEqual(cashTrade.map((row) => row.direction), ["received", "paid"]);
  assert.equal(cashTrade.find((row) => row.direction === "paid")?.paid_by_worker_id, gonzalo);
  assert.equal(cashTrade.find((row) => row.direction === "received")?.paid_by_worker_id, null);

  assert.deepEqual(buildTransactionPaymentPayloads(transactionId, base), []);
  assert.deepEqual(
    buildTransactionPaymentPayloads(transactionId, { ...base, cashPaid: 40, paidByWorkerId: gonzalo }),
    gonzaloPurchase
  );
});

test("transaction payment repository reads and writes only canonical payment columns", () => {
  const repository = readFileSync(new URL("../src/services/database/tradeRepository.ts", import.meta.url), "utf8");
  const preflight = readFileSync(new URL("../src/services/database/supabasePreflight.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/database.types.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260729120000_unified_transaction_reconciliation.sql", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../unified-multi-item-transactions.sql", import.meta.url), "utf8");
  const paymentMigration = migration.match(/create table if not exists public\.transaction_payments[\s\S]*?\n\);/)?.[0] || "";
  const paymentBootstrap = bootstrap.match(/create table if not exists public\.transaction_payments[\s\S]*?\n\);/)?.[0] || "";

  for (const source of [repository, preflight, types, paymentMigration, paymentBootstrap]) {
    assert.doesNotMatch(source, /\btransaction_payments\b[\s\S]{0,240}\bworker_id\b(?!\s*:)/);
  }
  assert.match(repository, /\.select\("id,transaction_id,direction,payment_method,amount,paid_by_worker_id,note,paid_at"\)/);
  assert.match(repository, /buildTransactionPaymentPayloads\(transactionId,\s*transaction\)/);
  assert.match(repository, /\.upsert\(paymentRows,\s*\{\s*onConflict:\s*"transaction_id,direction,payment_method"\s*\}\)/);
  assert.match(repository, /saveTrade\(transaction,\s*\{\s*syncPayments:\s*false\s*\}\)/);
  assert.ok(
    repository.lastIndexOf("await saveTransactionPayments(transactionId, persistedTrade)")
      > repository.lastIndexOf('from("transaction_item_ownership_shares")'),
    "payment persistence must run after the other child rows so payment-only Retry is safe"
  );
  assert.match(types, /paid_by_worker_id:\s*string\s*\|\s*null/);
  assert.match(paymentMigration, /paid_by_worker_id uuid/);
  assert.match(paymentBootstrap, /paid_by_worker_id uuid/);
});

test("payment retry UI calls only the dedicated payment operation", () => {
  const unified = readFileSync(new URL("../src/pages/UnifiedTransactionPage.tsx", import.meta.url), "utf8");
  const trade = readFileSync(new URL("../src/pages/TradePage.tsx", import.meta.url), "utf8");
  for (const source of [unified, trade]) {
    assert.match(source, /Retry payment only/);
    assert.match(source, /saveTransactionPayments\(paymentRetry\.error\.transactionId,\s*paymentRetry\.error\.transaction\)/);
  }
});

test("image retry preserves Storage and metadata identity and can be disabled after draft failure", () => {
  const upload = readFileSync(new URL("../src/services/images/saleImageService.ts", import.meta.url), "utf8");
  const field = readFileSync(new URL("../src/components/sales/ImageAttachmentField.tsx", import.meta.url), "utf8");
  const unified = readFileSync(new URL("../src/pages/UnifiedTransactionPage.tsx", import.meta.url), "utf8");
  const trade = readFileSync(new URL("../src/pages/TradePage.tsx", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/services/database/tradeRepository.ts", import.meta.url), "utf8");
  assert.match(upload, /stableImageId:\s*string\s*=\s*crypto\.randomUUID\(\)/);
  assert.match(upload, /resumeAttachment\?\.imagePath/);
  assert.match(upload, /storageObjectExists\(attachment\.imagePath\)/);
  assert.match(upload, /\.upsert\(payload,\s*\{\s*onConflict:\s*"id"\s*\}\)/);
  assert.match(upload, /Image uploaded; record still needs to be saved/);
  assert.doesNotMatch(upload, /\bupdated_at\b/);
  assert.match(field, /retryAttachmentId\s*\|\|\s*targetId\s*\|\|\s*crypto\.randomUUID\(\)/);
  assert.match(field, /uploadFile\(undefined,\s*image\.id,\s*image\.id,\s*image\)/);
  assert.match(field, /resumeAttachment:\s*metadataAttachment\s*\|\|\s*resumeAttachment/);
  assert.match(field, /disabled=\{retryDisabled\}/);
  assert.match(unified, /saveTransactionImage\(file,\s*persisted\.id,\s*itemId,\s*imageType,\s*onProgress,\s*stableImageId,\s*resumeAttachment\)/);
  assert.match(trade, /saveTransactionImage\(file,\s*persisted\.id,\s*itemId,\s*imageType,\s*onProgress,\s*stableImageId,\s*resumeAttachment\)/);
  assert.match(repository, /transaction_images"\)\.upsert\(desiredRows,\s*\{\s*onConflict:\s*"id"\s*\}\)/);
  assert.match(repository, /!image\.reusedFromImageId/);
  assert.equal((repository.match(/\.from\("financial_transactions"\)\s*\n\s*\.upsert/g) || []).length, 1);
});

test("balance writes precede the completed parent transition", () => {
  const source = readFileSync(new URL("../src/services/database/tradeRepository.ts", import.meta.url), "utf8");
  const balanceWrite = source.indexOf('from("transaction_internal_balances")');
  const completedTransition = source.indexOf('status: "completed"', balanceWrite);
  assert.ok(balanceWrite >= 0);
  assert.ok(completedTransition > balanceWrite);
});

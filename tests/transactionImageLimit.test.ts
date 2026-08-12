import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fitImagesWithinLimit, TRANSACTION_PHOTO_LIMIT } from "../src/utils/transactionImages.ts";

test("transaction-level photo capacity is twenty", () => {
  assert.equal(TRANSACTION_PHOTO_LIMIT, 20);
});

test("a gallery selection fills only the remaining capacity", () => {
  const selected = Array.from({ length: 10 }, (_, index) => `photo-${index + 1}`);
  const result = fitImagesWithinLimit(selected, 14, TRANSACTION_PHOTO_LIMIT);

  assert.deepEqual(result.accepted, selected.slice(0, 6));
  assert.equal(result.skippedCount, 4);
  assert.equal(result.available, 6);
});

test("no selection is accepted after the transaction photo limit is reached", () => {
  const result = fitImagesWithinLimit(["extra"], 20, TRANSACTION_PHOTO_LIMIT);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.skippedCount, 1);
});

test("unified and trade flows use the shared limit while item limits stay separate", () => {
  const unified = readFileSync(new URL("../src/pages/UnifiedTransactionPage.tsx", import.meta.url), "utf8");
  const trade = readFileSync(new URL("../src/pages/TradePage.tsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../src/components/sales/ImageAttachmentField.tsx", import.meta.url), "utf8");

  assert.match(unified, /label="Transaction photos"[\s\S]*?maxImages=\{TRANSACTION_PHOTO_LIMIT\}/);
  assert.match(trade, /label="General trade photos"[\s\S]*?maxImages=\{TRANSACTION_PHOTO_LIMIT\}/);
  assert.match(unified, /description="Up to 20 transaction photos\./);
  assert.match(trade, /description="Up to 20 transaction photos\./);
  assert.match(unified, /label="Item front \/ detail photos"[\s\S]*?maxImages=\{3\}/);
  assert.match(field, /multiple=\{multiple\}/);
  assert.match(field, /\{attachments\.length\} \/ \{maxImages\} photos/);
  assert.match(field, /skipped because only/);
});

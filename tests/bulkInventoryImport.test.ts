import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  filterBulkQueue,
  pageBulkQueue,
  runWithConcurrency,
  sortBulkQueue,
} from "../src/utils/bulkInventoryImport.ts";

const simulated = Array.from({ length: 200 }, (_, uploadOrder) => ({
  uploadOrder,
  status: uploadOrder % 17 === 0 ? "failed" : uploadOrder % 5 === 0 ? "needs_review" : "identified",
  overallConfidence: uploadOrder % 5 === 0 ? "low" as const : "high" as const,
  recognizedName: `Card ${String(uploadOrder).padStart(3, "0")}`,
  adjustedMarket: uploadOrder % 11 === 0 ? undefined : uploadOrder + 0.99,
  condition: uploadOrder % 7 === 0 ? undefined : "Near Mint / NM",
  possibleDuplicate: uploadOrder === 42,
}));

test("200-image review queue filters, sorts, and paginates without dropping rows", () => {
  const all = filterBulkQueue(simulated, { filter: "all" });
  assert.equal(all.length, 200);
  const pages = Array.from({ length: 4 }, (_, index) => pageBulkQueue(all, index + 1, 50).items);
  assert.deepEqual(pages.map((page) => page.length), [50, 50, 50, 50]);
  assert.equal(new Set(pages.flat().map((item) => item.uploadOrder)).size, 200);
  assert.equal(filterBulkQueue(simulated, { filter: "failed" }).length, simulated.filter((item) => item.status === "failed").length);
  assert.deepEqual(filterBulkQueue(simulated, { filter: "all", duplicatesOnly: true }).map((item) => item.uploadOrder), [42]);
  assert.ok(filterBulkQueue(simulated, { filter: "all", missingPriceOnly: true }).length > 0);
  assert.ok(filterBulkQueue(simulated, { filter: "all", missingConditionOnly: true }).length > 0);
  assert.equal(sortBulkQueue(simulated, "upload")[199].uploadOrder, 199);
  assert.equal(sortBulkQueue(simulated, "market")[0].uploadOrder, 199);
});

test("controlled uploader never exceeds configured concurrency for 200 files", async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency(Array.from({ length: 200 }, (_, index) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, index % 3));
    active -= 1;
    return index;
  }), 3);
  assert.equal(results.length, 200);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 200);
  assert.ok(peak <= 3);
});

test("migration creates a durable inventory-only queue and dedicated bucket", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260814010000_bulk_inventory_import.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.bulk_inventory_import_jobs/i);
  assert.match(sql, /create table if not exists public\.bulk_inventory_import_items/i);
  assert.match(sql, /bulk-inventory-imports/i);
  assert.match(sql, /for update of item skip locked/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.financial_transactions/i);
});

test("bulk importer is not coupled to the transaction 20-photo cap", () => {
  const source = readFileSync(new URL("../src/components/sales/BatchInventoryImporter.tsx", import.meta.url), "utf8");
  assert.match(source, /Drop 200\+ card photos/);
  assert.doesNotMatch(source, /MAX_TRANSACTION_IMAGES|TRANSACTION_IMAGE_LIMIT|slice\(0,\s*20\)/);
  assert.match(source, /Confirm All High-Confidence/);
});

test("bulk recognition persists local crops, hash cache state, and bounded Luna usage", () => {
  const repository = readFileSync(new URL("../src/services/database/bulkInventoryImportRepository.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../supabase/functions/bulk-inventory-process/index.ts", import.meta.url), "utf8");
  assert.match(repository, /automaticallyPrepareCard\(normalized\)/);
  assert.match(repository, /recognitionImagePath/);
  assert.doesNotMatch(repository, /topRegionImagePath/);
  assert.match(repository, /maxLongEdge: 1280/);
  assert.match(worker, /reuseCachedRecognition/);
  assert.match(worker, /model: "gpt-5\.6-luna"/);
  assert.match(worker, /maximumCalls: 1/);
  assert.doesNotMatch(worker, /firstPassWasDecisive/);
  assert.doesNotMatch(worker, /recognitionMode: "top_name"/);
  assert.match(worker, /recognitionMode: "details"/);
  assert.doesNotMatch(worker, /gpt-5\.6-(?:sol|terra)/);
});

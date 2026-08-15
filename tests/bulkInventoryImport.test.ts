import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  bulkItemMarketValue,
  bulkItemReviewIssues,
  filterBulkQueue,
  isBulkItemImportReady,
  isStampedBulkItem,
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

test("review readiness requires an exact match, physical variant, condition, and condition-aware price", () => {
  const base = {
    uploadOrder: 0,
    status: "identified",
    overallConfidence: "high" as const,
    selectedCandidate: { name: "Pikachu", pricing: { variants: [{ name: "holofoil", market: 18 }, { name: "reverseHolofoil", market: 12 }] } },
    condition: "Near Mint / NM",
    baseMarket: 18,
    ownershipShares: [{ ownershipPercentage: 100 }],
  };
  assert.deepEqual(bulkItemReviewIssues(base), ["variant"]);
  assert.equal(isBulkItemImportReady(base), false);
  const variantChosen = { ...base, marketVariant: "holofoil" };
  assert.equal(isBulkItemImportReady(variantChosen), true);
  assert.equal(bulkItemMarketValue(variantChosen), 18);
  const played = { ...variantChosen, condition: "Lightly Played / LP" };
  assert.ok(bulkItemReviewIssues(played).includes("price"));
  assert.equal(isBulkItemImportReady(played), false);
  assert.equal(isBulkItemImportReady({ ...played, adjustedMarket: 14 }), true);
  assert.equal(isBulkItemImportReady({ ...variantChosen, condition: "Unknown", adjustedMarket: undefined }), true);
  assert.ok(bulkItemReviewIssues({ ...variantChosen, ownershipShares: [] }).includes("ownership"));
  assert.equal(isStampedBulkItem({ ...variantChosen, marketVariant: "stamped/manual" }), true);
});

test("dedicated review separates provider identity from inventory details", () => {
  const source = readFileSync(new URL("../src/components/sales/BatchInventoryImporter.tsx", import.meta.url), "utf8");
  assert.match(source, /Review Match/);
  assert.match(source, /Official Provider Card/);
  assert.match(source, /Is this the correct card and printing\?/);
  assert.match(source, /Yes, This Is It/);
  assert.match(source, /No, Wrong Card/);
  assert.match(source, /Other Possible Matches/);
  assert.match(source, /Search Manually with Recognized Details/);
  assert.match(source, /Save & Next/);
  assert.match(source, /Reviewing \{itemNumber\} of \{itemCount\}/);
});

test("bulk review resolves each item's durable original photo with visible recovery states", () => {
  const source = readFileSync(new URL("../src/components/sales/BatchInventoryImporter.tsx", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/services/database/bulkInventoryImportRepository.ts", import.meta.url), "utf8");
  const lightbox = readFileSync(new URL("../src/components/sales/ImageLightbox.tsx", import.meta.url), "utf8");
  assert.match(source, /data-bulk-source-item-id=\{item\.id\}/);
  assert.match(source, /resolveBulkImportSourceImageUrl\(item\.sourceImagePath/);
  assert.match(source, /Original photo unavailable/);
  assert.match(source, /> Retry</);
  assert.match(source, /View Original Photo/);
  assert.match(source, /object-contain/);
  assert.match(repository, /getPublicUrl\(sourceImagePath\)/);
  assert.match(repository, /createSignedUrl\(sourceImagePath, 60 \* 60\)/);
  assert.doesNotMatch(source, /URL\.createObjectURL/);
  assert.match(lightbox, /aria-label="Zoom out"/);
  assert.match(lightbox, /> Fit</);
  assert.match(lightbox, /aria-label="Zoom in"/);
});

test("bulk review loads up to ten same-name alternatives and logs provider pricing without financial writes", () => {
  const source = readFileSync(new URL("../src/components/sales/BatchInventoryImporter.tsx", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/services/database/bulkInventoryImportRepository.ts", import.meta.url), "utf8");
  assert.match(source, /searchPokemonCardsManually/);
  assert.match(source, /pageSize: 10/);
  assert.match(repository, /\[Bulk Import Review\] provider pricing/);
  assert.match(repository, /pricingVariants/);
  assert.doesNotMatch(repository, /financial_transactions/);
});

test("issue filters isolate missing fields, stamped cards, low confidence, and source-photo duplicates", () => {
  const variants = [{ name: "normal", market: 2 }, { name: "reverseHolofoil", market: 4 }];
  const rows = [
    { uploadOrder: 0, status: "identified", selectedCandidate: { name: "A", pricing: { variants } }, condition: "Near Mint / NM", baseMarket: 2 },
    { uploadOrder: 1, status: "identified", selectedCandidate: { name: "B", pricing: { variants: [{ name: "normal", market: 3 }] } }, condition: "Lightly Played / LP", baseMarket: 3 },
    { uploadOrder: 2, status: "needs_review", selectedCandidate: { name: "C", pricing: { variants: [] } }, overallConfidence: "low" as const, marketVariant: "stamped/manual", adjustedMarket: 9, possibleDuplicate: true },
  ];
  assert.deepEqual(filterBulkQueue(rows, { filter: "missing_variant" }).map((row) => row.uploadOrder), [0]);
  assert.deepEqual(filterBulkQueue(rows, { filter: "missing_price" }).map((row) => row.uploadOrder), [1]);
  assert.deepEqual(filterBulkQueue(rows, { filter: "missing_condition" }).map((row) => row.uploadOrder), [2]);
  assert.deepEqual(filterBulkQueue(rows, { filter: "stamped" }).map((row) => row.uploadOrder), [2]);
  assert.deepEqual(filterBulkQueue(rows, { filter: "low_confidence" }).map((row) => row.uploadOrder), [2]);
  assert.deepEqual(filterBulkQueue(rows, { filter: "possible_duplicate" }).map((row) => row.uploadOrder), [2]);
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
  assert.match(source, /multiple accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(source, /Confirm & Add to Inventory/);
  assert.match(source, /Your uploaded photo/);
  assert.match(source, /Provider reference/);
  assert.match(source, /Review One by One/);
  assert.doesNotMatch(source, /Approve to inventory|Confirm All High-Confidence/);
});

test("review edits are local/provider operations and only explicit retry requeues AI recognition", () => {
  const source = readFileSync(new URL("../src/components/sales/BatchInventoryImporter.tsx", import.meta.url), "utf8");
  assert.match(source, /One tap changes the provider match without calling OpenAI/);
  assert.match(source, /Retry AI Recognition/);
  assert.match(source, /retryBulkImportItems\(targets\.map/);
  assert.doesNotMatch(source, /cardScanService|identifyPokemonCard|pokemon-card-identify/);
});

test("final bulk import preserves both photos and uses a stable idempotent inventory id", () => {
  const repository = readFileSync(new URL("../src/services/database/bulkInventoryImportRepository.ts", import.meta.url), "utf8");
  assert.match(repository, /const stableInventoryId = item\.inventoryPurchaseId \|\| item\.id/);
  assert.match(repository, /id: stableInventoryId/);
  assert.match(repository, /frontImageUrl: item\.sourceImageUrl/);
  assert.match(repository, /officialCardImageUrl: candidate\.imageLarge \|\| candidate\.imageSmall/);
  assert.match(repository, /acquisitionMethod: "existing_inventory_import"/);
  assert.doesNotMatch(repository, /financial_transactions/);
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

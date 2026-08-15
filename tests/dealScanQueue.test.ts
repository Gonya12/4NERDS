import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendBulkScanSelection } from "../src/utils/dealScanQueue.ts";
import { bulkReviewProviderImage, bulkReviewSourceImage } from "../src/utils/bulkImportReview.ts";

type MockFile = { name: string; size: number; type: string; lastModified: number };
const photo = (index: number, type = "image/jpeg"): MockFile => ({ name: `card-${index}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`, size: 1_000 + index, type, lastModified: 1_700_000_000_000 + index });

test("one, ten, two hundred, and five hundred desktop selections retain every supported photo", () => {
  assert.equal(appendBulkScanSelection([], [photo(1)]).length, 1);
  assert.equal(appendBulkScanSelection([], Array.from({ length: 10 }, (_, index) => photo(index))).length, 10);
  assert.equal(appendBulkScanSelection([], Array.from({ length: 200 }, (_, index) => photo(index))).length, 200);
  assert.equal(appendBulkScanSelection([], Array.from({ length: 500 }, (_, index) => photo(index))).length, 500);
});

test("mixed JPG, PNG, and WebP batches are accepted while unsupported files are ignored", () => {
  const selected = appendBulkScanSelection([], [photo(1), photo(2, "image/png"), photo(3, "image/webp"), photo(4, "application/pdf")]);
  assert.deepEqual(selected.map((row) => row.file.type), ["image/jpeg", "image/png", "image/webp"]);
});

test("another batch appends and exact repeated file metadata is warned, not deleted", () => {
  const first = appendBulkScanSelection([], [photo(1), photo(2)]);
  const second = appendBulkScanSelection(first, [photo(2), photo(3)]);
  assert.equal(second.length, 2);
  assert.equal(second[0].possibleDuplicate, true);
  assert.equal(second[1].possibleDuplicate, false);
});

test("cancelling the native picker produces no queue additions", () => {
  assert.deepEqual(appendBulkScanSelection([], null), []);
  assert.deepEqual(appendBulkScanSelection([], []), []);
});

test("New Deal uses desktop multiple inputs and a failure-isolated controlled queue", () => {
  const source = readFileSync(new URL("../src/pages/NewDealPage.tsx", import.meta.url), "utf8");
  const sidePanel = source.slice(source.indexOf("function sidePanel"), source.indexOf("function summaryCard"));
  assert.match(sidePanel, /type="file" accept="image\/\*" multiple/);
  assert.match(sidePanel, /Array\.from\(event\.currentTarget\.files \|\| \[\]\)/);
  assert.match(sidePanel, /capture="environment"/);
  assert.match(source, /while \(true\)[\s\S]*?find\(\(row\) => row\.status === "waiting"\)/);
  assert.match(source, /catch \(unknownError\)[\s\S]*?status: "failed"/);
  assert.doesNotMatch(source.slice(source.indexOf("async function processScanQueue"), source.indexOf("const waitingScanCount")), /Promise\.all/);
});

test("the active New Deal bulk Review route opens match verification instead of the generic Deal Item editor", () => {
  const page = readFileSync(new URL("../src/pages/NewDealPage.tsx", import.meta.url), "utf8");
  const review = readFileSync(new URL("../src/components/sales/BulkImportCardReview.tsx", import.meta.url), "utf8");
  const queueMarkup = page.slice(page.indexOf("{scanQueue.length ?"), page.indexOf("{step === \"build\""));
  assert.match(queueMarkup, /openBulkImportReview\(row, dealItem\)/);
  assert.doesNotMatch(queueMarkup, /setEditing\(dealItem\)/);
  assert.match(page, /<BulkImportCardReview/);
  assert.match(page, /open=\{Boolean\(editing\) && !bulkReviewId\}/);
  assert.match(review, /Review Card Match/);
  assert.match(review, /Original Upload/);
  assert.match(review, /TCG Database Match/);
  assert.match(review, /Correct/);
  assert.match(review, /Wrong Card/);
});

test("bulk review prefers a persisted item photo and keeps provider identity and price fields", () => {
  const page = readFileSync(new URL("../src/pages/NewDealPage.tsx", import.meta.url), "utf8");
  const review = readFileSync(new URL("../src/components/sales/BulkImportCardReview.tsx", import.meta.url), "utf8");
  assert.match(review, /bulkReviewSourceImage\(item, record\)/);
  assert.match(review, /bulkReviewProviderImage/);
  assert.match(review, /item\.marketPriceVariant/);
  assert.match(page, /preserveScanPhoto\(item, row\.file\)/);
  assert.match(page, /scanQueueDraftKey/);
  assert.match(page, /previewUrl: item\?\.imageUrl \|\| persistedPreview/);
  assert.match(page, /\[Bulk Import Review\] open/);
});

test("four different review items keep their own original and provider photos across refresh", () => {
  const records = ["Gholdengo ex", "Rillaboom VMAX", "another card", "Dudunsparce ex"].map((name, index) => ({
    item: { id: `item-${index}`, imageUrl: `https://storage.test/source-${index}.jpg`, imagePath: `job/source-${index}.jpg`, officialCardImageUrl: `https://provider.test/card-${index}.jpg` },
    record: { id: `row-${index}`, itemId: `item-${index}`, previewUrl: `blob:session-${index}`, providerImageUrl: `https://provider.test/fallback-${index}.jpg`, name },
  }));
  assert.deepEqual(records.map(({ item, record }) => bulkReviewSourceImage(item, record)), records.map((_, index) => `https://storage.test/source-${index}.jpg`));
  assert.deepEqual(records.map(({ item, record }) => bulkReviewProviderImage(item, record)), records.map((_, index) => `https://provider.test/card-${index}.jpg`));
  const refreshed = records.map(({ item, record }) => bulkReviewSourceImage(item, { ...record, previewUrl: undefined }));
  assert.deepEqual(refreshed, records.map((_, index) => `https://storage.test/source-${index}.jpg`));
  assert.notEqual(refreshed[0], refreshed[3]);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/NewDealPage.tsx", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../src/components/sales/SalesDashboardPrimitives.tsx", import.meta.url), "utf8");
const unifiedSource = readFileSync(new URL("../src/pages/UnifiedTransactionPage.tsx", import.meta.url), "utf8");
const tradeSource = readFileSync(new URL("../src/pages/TradePage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("mobile builder renders only the selected deal side while desktop keeps both", () => {
  assert.match(source, /sidePanel\(selectedSide\)/);
  assert.match(source, /lg:hidden/);
  assert.match(source, /hidden gap-3 lg:grid lg:grid-cols-2/);
  assert.match(source, /sidePanel\("incoming"\).*sidePanel\("outgoing"\)/s);
});

test("mobile configuration uses compact rows and dedicated sheets", () => {
  assert.match(source, /setDetailsOpen\(true\)/);
  assert.match(source, /setPaymentsOpen\(true\)/);
  assert.match(source, /setPhotosOpen\(true\)/);
  assert.match(source, /title="Deal Details"/);
  assert.match(source, /title="Payment"/);
  assert.match(source, /title="Transaction Photos"/);
  assert.match(source, /images\.length.*TRANSACTION_PHOTO_LIMIT/s);
});

test("mobile keeps presets, totals, and review actions reachable", () => {
  assert.match(source, /incomingDealPercentages : outgoingDealPercentages/);
  assert.match(source, /DIFFERENCE/);
  assert.match(source, /Potential inventory gain/);
  assert.match(source, /pb-\[calc\(\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(source, /> Pending</);
  assert.match(source, /Review Deal/);
});

test("Deal Item disables swipe dismissal and uses the near-full-screen editor sheet", () => {
  assert.match(source, /title=\{editing\?\.itemName \|\| "Deal Item"\}[\s\S]*?swipeToDismiss=\{false\}[\s\S]*?closeOnBackdrop=\{false\}[\s\S]*?mobileEditor/);
  assert.match(unifiedSource, /title="Transaction Item"[\s\S]*?swipeToDismiss=\{false\}[\s\S]*?closeOnBackdrop=\{false\}[\s\S]*?mobileEditor/);
  assert.match(tradeSource, /title=\{editingItem\?\.direction[\s\S]*?swipeToDismiss=\{false\}[\s\S]*?closeOnBackdrop=\{false\}[\s\S]*?mobileEditor/);
});

test("sheet scrolling is isolated from optional handle-only dismissal", () => {
  assert.doesNotMatch(modalSource, /<section[^>]*onTouchStart=/);
  assert.match(modalSource, /className=\{`modal-drag-indicator/);
  assert.match(modalSource, /bodyRef\.current\?\.scrollTop/);
  assert.match(styles, /\.responsive-modal-body[\s\S]*?overflow-y-auto[\s\S]*?overscroll-y-contain[\s\S]*?-webkit-overflow-scrolling: touch/);
  assert.match(styles, /\.responsive-modal-editor[\s\S]*?height: calc\(100dvh/);
});

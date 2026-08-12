import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/NewDealPage.tsx", import.meta.url), "utf8");

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

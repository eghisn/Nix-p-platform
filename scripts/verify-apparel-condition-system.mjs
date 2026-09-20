import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  APPAREL_CONDITION_GRADES,
  apparelConditionOptions,
  apparelMeasurementSummary,
  normalizeApparelMeasurements
} from "../src/data/apparelCondition.js";
import { draftProductFromFinanceStock, productRowFromFinanceStock } from "../api/_lib/financeState.js";
import { publicProductFingerprint } from "../api/_lib/publicCatalogRevision.js";

assert.ok(APPAREL_CONDITION_GRADES.includes("New With Tags"));
assert.ok(APPAREL_CONDITION_GRADES.includes("Damaged / Repair Needed"));
assert.ok(apparelConditionOptions("New-Sealed").includes("New-Sealed"), "Legacy apparel values must remain editable.");
assert.deepEqual(normalizeApparelMeasurements({ pitToPit: "54", sleeve: "21", ignored: "value" }), { pitToPit: "54", sleeve: "21" });
assert.deepEqual(
  apparelMeasurementSummary({ apparelMeasurements: { pitToPit: "54", length: "70" } }),
  ["Pit to pit: 54 cm", "Length: 70 cm"]
);

const apparelStock = {
  id: "stock-apparel-1",
  sku: "NXP-TEST-APP-001",
  item: "T-shirt",
  itemCondition: "Very Good Used",
  title: "Test Garment",
  artist: "NIXP Apparel",
  sellingPrice: 350000,
  garmentConditionNote: "Minor fading at collar",
  apparelMeasurements: { pitToPit: "54", length: "70" },
  originalTags: true,
  alterations: "Hem shortened",
  flaws: "Small repair on left cuff",
  fabricCare: "Cold wash, line dry"
};
const row = productRowFromFinanceStock({
  id: "apparel-1",
  category: "Apparel",
  apparel_type: "T-shirt",
  title: "Test Garment",
  artist: "NIXP Apparel",
  condition: "New Without Tags",
  raw: {}
}, apparelStock, 1);
assert.equal(row.raw.garmentConditionNote, apparelStock.garmentConditionNote);
assert.deepEqual(row.raw.apparelMeasurements, apparelStock.apparelMeasurements);
assert.equal(row.raw.originalTags, true);
assert.equal(row.raw.alterations, apparelStock.alterations);
assert.equal(row.raw.flaws, apparelStock.flaws);
assert.equal(row.raw.fabricCare, apparelStock.fabricCare);

const draft = draftProductFromFinanceStock(apparelStock, 1);
assert.equal(draft.raw.garmentConditionNote, apparelStock.garmentConditionNote);
assert.deepEqual(draft.raw.apparelMeasurements, apparelStock.apparelMeasurements);

const fingerprintBase = { id: "apparel-1", sku: apparelStock.sku, publishStatus: "Published", visibility: "Public" };
assert.notEqual(
  publicProductFingerprint({ ...fingerprintBase, apparelMeasurements: { pitToPit: "54" } }),
  publicProductFingerprint({ ...fingerprintBase, apparelMeasurements: { pitToPit: "55" } }),
  "Public deployment verification must include apparel measurements."
);

const [adminSource, financeSource, publicSource] = await Promise.all([
  readFile(new URL("../src/services/adminStore.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/finance/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8")
]);
for (const field of ["garmentConditionNote", "apparelMeasurements", "originalTags", "alterations", "flaws", "fabricCare"]) {
  assert.match(adminSource, new RegExp(field));
  assert.match(financeSource, new RegExp(field));
  assert.match(publicSource, new RegExp(field));
}
assert.match(
  financeSource,
  /<div class="field full" data-finance-apparel-fields hidden>/,
  "Finance must use a hideable field wrapper for apparel-only inputs."
);

console.log("Apparel condition workflow contracts verified.");

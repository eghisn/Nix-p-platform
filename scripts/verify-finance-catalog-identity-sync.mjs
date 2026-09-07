import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canCreateFinanceCatalogDraft,
  draftProductFromFinanceStock,
  hasFinanceCatalogIdentityDrift,
  mergeFinanceStockIdentity,
  productRowFromFinanceStock
} from "../api/_lib/financeState.js";

const incompleteStock = {
  id: "stock-wampire",
  sku: "NXP-2026-VNL-0069",
  item: "Vinyl",
  itemCondition: "New-Sealed",
  artist: "Wampire",
  title: "",
  edition: "",
  barcode: "",
  catalogNumber: "",
  qty: 1,
  sellingPrice: 0,
  listingMode: "Standard Sale"
};

const placeholderProduct = draftProductFromFinanceStock(incompleteStock, 1);
assert.equal(placeholderProduct.title, "Untitled inventory item");
assert.equal(canCreateFinanceCatalogDraft(incompleteStock), false);

const completedStock = {
  ...incompleteStock,
  artist: "Wampire",
  title: "Bazaar",
  edition: "Vinyl, LP, Album, 180 gram",
  barcode: "644110028518",
  catalogNumber: "PRC-285",
  sellingPrice: 340625
};

assert.equal(canCreateFinanceCatalogDraft(completedStock), true);
const financeProduct = productRowFromFinanceStock(placeholderProduct, completedStock, 1);
const repaired = mergeFinanceStockIdentity(placeholderProduct, financeProduct);

assert.equal(repaired.title, "Bazaar");
assert.equal(repaired.artist, "Wampire");
assert.equal(repaired.price, 340625);
assert.equal(repaired.raw.edition, "Vinyl, LP, Album, 180 gram");
assert.equal(repaired.raw.barcode, "644110028518");
assert.equal(repaired.raw.catalogNumber, "PRC-285");
assert.deepEqual(repaired.details, []);
assert.equal(hasFinanceCatalogIdentityDrift(placeholderProduct, repaired), true);
assert.equal(hasFinanceCatalogIdentityDrift(repaired, mergeFinanceStockIdentity(repaired, productRowFromFinanceStock(repaired, completedStock, 1))), false);

const financeUi = await readFile(new URL("../apps/finance/index.html", import.meta.url), "utf8");
assert.match(financeUi, /field\("Title", "title", "text", "", true, "Artwork \/ item title"\)/);
assert.match(financeUi, /one SKU keeps one catalog identity/);

const financeSyncSource = await readFile(new URL("../api/_lib/financeState.js", import.meta.url), "utf8");
assert.match(financeSyncSource, /edit_revision: revision \+ 1/);
assert.match(financeSyncSource, /editorial_updated_by: "finance-stock"/);

console.log("Finance catalog identity synchronization contract passed.");

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
  vinylSize: "",
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
  vinylSize: "12",
  sellingPrice: 340625
};

assert.equal(canCreateFinanceCatalogDraft(completedStock), true);
const versionedPlaceholder = { ...placeholderProduct, edit_revision: 17 };
const financeProduct = productRowFromFinanceStock(versionedPlaceholder, completedStock, 1);
const repaired = mergeFinanceStockIdentity(versionedPlaceholder, financeProduct);

assert.equal(repaired.title, "Bazaar");
assert.equal(repaired.artist, "Wampire");
assert.equal(repaired.price, 340625);
assert.equal(repaired.raw.edition, "Vinyl, LP, Album, 180 gram");
assert.equal(repaired.raw.barcode, "644110028518");
assert.equal(repaired.raw.catalogNumber, "PRC-285");
assert.equal(repaired.raw.vinylSize, "12");
assert.deepEqual(repaired.details, []);
assert.equal(financeProduct.edit_revision, 17);
assert.equal(financeProduct.publish_status, "Draft", "Finance completion must not publish a catalog draft.");
assert.equal(financeProduct.visibility, "Private", "Finance completion must not expose a catalog draft.");
assert.equal(hasFinanceCatalogIdentityDrift(versionedPlaceholder, repaired), true);
assert.equal(hasFinanceCatalogIdentityDrift(repaired, mergeFinanceStockIdentity(repaired, productRowFromFinanceStock(repaired, completedStock, 1))), false);

const legacyPublished = productRowFromFinanceStock(
  {
    ...versionedPlaceholder,
    publish_status: "Published",
    visibility: "Public"
  },
  completedStock,
  1
);
assert.equal(legacyPublished.publish_status, "Published", "A previously live legacy item must remain live during Finance sync.");
assert.equal(legacyPublished.visibility, "Public", "A previously live legacy item must remain public during Finance sync.");

const manuallyPublished = productRowFromFinanceStock(
  {
    ...versionedPlaceholder,
    raw: { adminPublishOverride: "Published" }
  },
  completedStock,
  1
);
assert.equal(manuallyPublished.publish_status, "Published");
assert.equal(manuallyPublished.visibility, "Public");

const manuallyDrafted = productRowFromFinanceStock(
  {
    ...versionedPlaceholder,
    raw: { adminPublishOverride: "Draft" }
  },
  completedStock,
  1
);
assert.equal(manuallyDrafted.publish_status, "Draft");
assert.equal(manuallyDrafted.visibility, "Private");

const posterStock = {
  id: "stock-poster",
  sku: "NXP-2026-OBJ-0001",
  item: "Poster",
  itemCondition: "New-Sealed",
  artist: "NIXP",
  title: "Launch Poster",
  dimensions: "A2 / 42 x 59.4 cm",
  printDetails: "Screen print, signed edition of 50",
  qty: 1,
  sellingPrice: 250000,
  listingMode: "Standard Sale"
};
const posterDraft = draftProductFromFinanceStock(posterStock, 1);
assert.equal(posterDraft.category, "Publishing");
assert.equal(posterDraft.format, "Poster");
assert.equal(posterDraft.display_format, "Poster");
assert.equal(posterDraft.raw.financeItemType, "Poster");
assert.equal(posterDraft.raw.financeMetadata.dimensions, "A2 / 42 x 59.4 cm");
assert.match(posterDraft.details.join(" "), /Dimensions: A2/);

const bookStock = {
  id: "stock-book",
  sku: "NXP-2026-PUB-0001",
  item: "Book",
  itemCondition: "New-Sealed",
  artist: "",
  title: "NIXP Reader",
  publisher: "NIXP Publishing",
  isbn: "978-1-23456-789-0",
  pages: "128",
  binding: "Perfect bound",
  language: "English",
  qty: 1,
  sellingPrice: 180000,
  listingMode: "Standard Sale"
};
assert.equal(canCreateFinanceCatalogDraft(bookStock), true);
const bookDraft = draftProductFromFinanceStock(bookStock, 1);
assert.equal(bookDraft.category, "Publishing");
assert.equal(bookDraft.format, "Book");
assert.equal(bookDraft.raw.financeMetadata.publisher, "NIXP Publishing");
assert.match(bookDraft.details.join(" "), /ISBN \/ ISSN/);

const apparelStock = {
  id: "stock-apparel",
  sku: "NXP-2026-APP-0001",
  item: "T-shirt",
  itemCondition: "New With Tags",
  artist: "NIXP",
  title: "Logo T-shirt",
  qty: 3,
  sizes: [
    { label: "S", quantity: 1 },
    { label: "M", quantity: 2 }
  ],
  sellingPrice: 250000,
  listingMode: "Standard Sale"
};
const apparelDraft = draftProductFromFinanceStock(apparelStock, 3);
assert.equal(apparelDraft.category, "Apparel");
assert.deepEqual(apparelDraft.sizes, [
  { label: "S", quantity: 1, soldOut: false },
  { label: "M", quantity: 2, soldOut: false }
]);
const syncedApparel = productRowFromFinanceStock(apparelDraft, apparelStock, 3);
assert.deepEqual(syncedApparel.sizes, apparelDraft.sizes);
const changedApparel = productRowFromFinanceStock(syncedApparel, {
  ...apparelStock,
  qty: 4,
  sizes: [...apparelStock.sizes, { label: "L", quantity: 1 }]
}, 4);
assert.equal(hasFinanceCatalogIdentityDrift(syncedApparel, changedApparel), true, "A per-size stock edit must synchronize to the catalog.");

const financeUi = await readFile(new URL("../apps/finance/index.html", import.meta.url), "utf8");
assert.match(financeUi, /field\("Title", "title", "text", "", true, "Artwork \/ item title"\)/);
assert.match(financeUi, /one SKU keeps one catalog identity/);
assert.match(financeUi, /Vinyl Size/, "Finance must collect a structured vinyl size.");
assert.match(financeUi, /"Poster", "Book", "Zine", "Magazine"/);
assert.match(financeUi, /data-finance-publication-fields/);
assert.match(financeUi, /Available size quantities/);
assert.match(financeUi, /Apparel size quantities must equal Qty before saving/);

const financeSyncSource = await readFile(new URL("../api/_lib/financeState.js", import.meta.url), "utf8");
assert.match(financeSyncSource, /edit_revision: revision \+ 1/);
assert.match(financeSyncSource, /editorial_updated_by: "finance-stock"/);
assert.match(financeSyncSource, /financeVinylSize/);
assert.match(financeSyncSource, /catalogCategoryForFinanceItem/);
assert.match(financeSyncSource, /financeItemType/);
assert.match(financeSyncSource, /financeApparelSizesForStock/);
assert.match(financeSyncSource, /vinylSize: normalizeVinylSize\(product\.vinylSize\)/, "Admin edits must mirror vinyl size to Finance.");

const adminStoreSource = await readFile(new URL("../api/admin/store.js", import.meta.url), "utf8");
assert.match(adminStoreSource, /syncAdminCatalogInventory\(refreshedTargets\)/, "The legacy backfill must also repair Finance rows that already existed.");

console.log("Finance catalog identity synchronization contract passed.");

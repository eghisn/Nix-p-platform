import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { products as seedProducts } from "../src/data/sampleData.js";
import { mergeStore, publicCatalogAction } from "../src/services/adminStore.js";

const root = process.cwd();
const clientSource = await readFile(`${root}/src/services/adminStore.js`, "utf8");
const serverSource = await readFile(`${root}/api/_lib/supabase.js`, "utf8");

const commerceStart = clientSource.indexOf("function normalizeVerifiedCommerce");
const commerceEnd = clientSource.indexOf("export function publicCatalogAction", commerceStart);
assert.ok(commerceStart >= 0 && commerceEnd > commerceStart, "Could not locate the public commerce reconciler.");
const commerceBoundary = clientSource.slice(commerceStart, commerceEnd);

assert.doesNotMatch(commerceBoundary, /publishStatus|publish_status|visibility/, "The public commerce refresh must not change catalog publication state.");
assert.match(serverSource, /select=id,price,qty,sizes&id=in/, "The prices endpoint must only fetch live commerce fields.");
assert.doesNotMatch(serverSource, /select=id,price,qty,sizes,publish_status,visibility/, "The prices endpoint must not expose catalog publication state.");

const publicProduct = { publishStatus: "Published", visibility: "Public" };
const draftProduct = { publishStatus: "Draft", visibility: "Private" };
assert.equal(publicCatalogAction(publicProduct, draftProduct), "unpublish");
assert.equal(publicCatalogAction(draftProduct, publicProduct), "publish");
assert.equal(publicCatalogAction(publicProduct, publicProduct), "update");
assert.equal(publicCatalogAction(draftProduct, draftProduct), "none");

const withdrawnSku = "NXP-2026-CST-0007";
const publicSeed = {
  version: "test",
  products: seedProducts,
  artists: [],
  collections: [],
  requests: [],
  offers: [],
  orders: [],
  cashflow: [],
  inventory: []
};
const activeSnapshotProduct = {
  ...seedProducts.find((product) => product.sku === "NXP-2026-CD-0022"),
  publishStatus: "Published",
  visibility: "Public"
};
const releasedPublicStore = {
  ...publicSeed,
  products: [activeSnapshotProduct]
};
const publicCatalog = mergeStore(publicSeed, releasedPublicStore, { publicOnly: true });
assert.equal(
  publicCatalog.products.some((product) => product.sku === withdrawnSku),
  false,
  "A SKU absent from the deployed public snapshot must not be restored from sample data."
);
assert.equal(publicCatalog.products.length, 1, "The public snapshot must remain the storefront allow-list.");

console.log("Verified the public catalog and live commerce boundaries stay separate, including unpublish releases.");

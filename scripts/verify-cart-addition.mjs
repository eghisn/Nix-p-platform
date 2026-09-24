import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { commitCartAddition } from "../src/services/cartAddition.js";

const product = {
  id: "finance-nxp-2026-cst-0012", publishStatus: "Published", visibility: "Public",
  artist: "Bastard Priest", title: "Vengeance...Of The Damned", price: 260000
};
let clears = 0;
let writes = 0;
let storedCart = [];
const add = (overrides = {}) => commitCartAddition({
  product, key: product.id, stock: 1, cart: storedCart,
  clearCheckoutSession: () => { clears += 1; },
  persistCart: (nextCart) => { writes += 1; storedCart = nextCart; },
  ...overrides
});

assert.deepEqual(add(), [product.id], "A sellable item must be persisted once.");
assert.equal(clears, 1);
assert.equal(writes, 1);
assert.equal(add(), null, "A second add must respect stock.");
assert.equal(writes, 1);
for (const invalid of [
  { stock: 0 },
  { product: { ...product, open_to_offers: true } },
  { product: { ...product, publishStatus: "Draft" } },
  { product: { ...product, visibility: "Hidden" } },
  { product: { ...product, price: 0 } },
  { key: `${product.id}::SoldOutSize`, stock: 0 }
]) {
  assert.equal(add({ cart: [], ...invalid }), null);
  assert.equal(writes, 1, "Rejected additions must never persist.");
}
assert.equal(add({
  cart: [], persistCart: () => { throw new Error("Storage unavailable"); }
}), null, "A failed cart write must not report success.");
assert.equal(writes, 1);

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.equal((source.match(/commitCartAddition\(\{/g) || []).length, 1, "Product pages and cards must share one add path.");
assert.match(source, /card\.querySelectorAll\("\[data-add-cart\]"\)\.forEach\(bindAddToCartButton\)/);
assert.match(source, /document\.querySelectorAll\("\[data-add-cart\]"\)\.forEach\(bindAddToCartButton\)/);
assert.match(source, /if \(button\.dataset\.cartBound === "true"\) return/);
assert.match(source, /if \(button\.dataset\.cartPending === "true"\) return/);
assert.match(source, /if \(nextCart\) \{\s*state\.cart = nextCart;\s*trackSuccessfulAddToCart\(product, 1\)/);

console.log("Cart addition success, stock, visibility, offer-only, storage-failure and handler checks passed.");

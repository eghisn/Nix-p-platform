import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkoutEventPayload } from "../src/services/checkoutEventPayload.js";

const row = (id, price, quantity, overrides = {}) => ({
  productId: id,
  product: { id, price, publishStatus: "Published", visibility: "Public" },
  stock: quantity,
  quantity,
  lineTotal: price * quantity,
  ...overrides
});

assert.equal(checkoutEventPayload([]), null, "An empty cart cannot initiate checkout.");
assert.deepEqual(checkoutEventPayload([
  row("product-a", 925000, 1),
  row("product-b", 211000, 1)
]), {
  content_ids: ["product-a", "product-b"],
  content_type: "product",
  value: 1136000,
  currency: "IDR",
  num_items: 2
});
assert.deepEqual(checkoutEventPayload([
  row("product-a", 925000, 1),
  row("product-a", 925000, 1)
]), {
  content_ids: ["product-a"],
  content_type: "product",
  value: 1850000,
  currency: "IDR",
  num_items: 2
}, "Different sizes of one product keep one stable content ID.");

for (const invalid of [
  row("product-a", 925000, 1, { stock: 0 }),
  row("product-a", 925000, 1, { quantity: 0 }),
  row("product-a", 925000, 1, { lineTotal: 0 }),
  row("product-a", 925000, 1, { productId: "wrong-id" }),
  row("product-a", 0, 1),
  row("product-a", 925000, 1, { product: { id: "product-a", price: 925000, publishStatus: "Draft", visibility: "Public" } }),
  row("product-a", 925000, 1, { product: { id: "product-a", price: 925000, publishStatus: "Published", visibility: "Hidden" } }),
  row("product-a", 925000, 1, { product: { id: "product-a", price: 925000, publishStatus: "Published", visibility: "Public", open_to_offers: true } })
]) assert.equal(checkoutEventPayload([invalid]), null, "Invalid or non-cart merchandise cannot initiate checkout.");

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(source, /const \{ rows, total \} = await cartSummary\(\);\s*const checkoutPayload = checkoutEventPayload\(rows\)/);
assert.match(source, /data-checkout-form \$\{checkoutPayload \? `data-meta-checkout=/);
assert.match(source, /trackCurrentPageView\(\);\s*syncCheckoutEntry\(\)/);
assert.doesNotMatch(source, /data-cart-checkout[^\n]*InitiateCheckout/);

console.log("Checkout Pixel payload, empty cart, invalid stock, offer-only, price, identity and render guards passed.");

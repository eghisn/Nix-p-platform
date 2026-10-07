import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productMarkup } from "../api/_lib/catalogPage.js";

const product = {
  id: "stock-zero-test",
  category: "Objects",
  artist: "NIXP",
  title: "Stock zero test",
  price: 1000,
  qty: 0,
  condition: "New-Sealed",
  image: "/public/nixp-logo.png"
};

const soldOutMarkup = productMarkup(product);
assert.match(soldOutMarkup, /<section class="product-detail" data-product-id="stock-zero-test">/, "Server-rendered product pages must expose the product id for the live stock refresh.");
assert.match(soldOutMarkup, /<figure class="product-art product-art-large is-sold-out"><img[^>]+><span class="sold-out-label">Sold out<\/span>/, "Server-rendered sold-out product artwork must be dimmed and labeled on first paint.");
assert.match(soldOutMarkup, /data-add-cart="stock-zero-test" disabled>Sold out<\/button>/, "Stock zero product pages must render a disabled Sold out control.");
assert.doesNotMatch(soldOutMarkup, />Add to cart<\/button>/, "Stock zero product pages must not render Add to cart.");

const inStockMarkup = productMarkup({ ...product, qty: 1 });
assert.match(inStockMarkup, /<figure class="product-art product-art-large\s"><img/, "In-stock product artwork must retain its normal appearance.");
assert.doesNotMatch(inStockMarkup, /class="product-art product-art-large is-sold-out"/, "In-stock product artwork must not be dimmed.");
assert.match(inStockMarkup, /data-add-cart="stock-zero-test" >Add to cart<\/button>/, "In-stock product pages must remain purchasable.");

const commerceStore = readFileSync(new URL("../src/services/adminStore.js", import.meta.url), "utf8");
const commerceClient = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(commerceStore, /if \(!verifiedIds\.size\) return currentStore;[\s\S]*?detail: \{ productIds: \[\.\.\.verifiedIds\] \}/, "Failed or incomplete commerce verification must not broadcast stale snapshot stock to the page.");
assert.match(commerceClient, /function applyPublicCommerceStateToDom\(event\)[\s\S]*?if \(!verifiedIds\.has\(String\(product\.id\)\)\) continue;/, "The page may patch stock styling only for products explicitly confirmed by the live commerce API.");

console.log("Public product stock state contract passed.");

import assert from "node:assert/strict";
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
assert.match(soldOutMarkup, /data-add-cart="stock-zero-test" disabled>Sold out<\/button>/, "Stock zero product pages must render a disabled Sold out control.");
assert.doesNotMatch(soldOutMarkup, />Add to cart<\/button>/, "Stock zero product pages must not render Add to cart.");

const inStockMarkup = productMarkup({ ...product, qty: 1 });
assert.match(inStockMarkup, /data-add-cart="stock-zero-test" >Add to cart<\/button>/, "In-stock product pages must remain purchasable.");

console.log("Public product stock state contract passed.");

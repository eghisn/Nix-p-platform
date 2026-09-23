import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRecentReleaseProduct } from "../src/data/homeCollections.js";

function productQuantity(product = {}) {
  if (Array.isArray(product.sizes) && product.sizes.length) {
    return product.sizes.reduce((total, size) => total + Math.max(0, Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) || 0), 0);
  }
  return Math.max(0, Number(product.qty ?? 1) || 0);
}

const [clientSource, buildSource] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("./build.mjs", import.meta.url), "utf8")
]);

assert.match(clientSource, /const soldOut = totalProductStock\(product\) <= 0;/, "Client slider must use the same total-stock rule as product pages.");
assert.match(clientSource, /class="slide \$\{soldOut \? "is-sold-out" : ""\}"/, "Client slider must expose its sold-out state.");
assert.match(clientSource, /class="product-art slide-art \$\{soldOut \? "is-sold-out" : ""\}"/, "Client slider artwork must dim when unavailable.");
assert.match(clientSource, /\$\{soldOut \? `<span class="sold-out-label">Sold out<\/span>` : ""\}/, "Client slider must render the Sold out label.");

assert.match(buildSource, /const soldOut = productQuantity\(product\) <= 0;/, "Server-rendered home slider must use the catalog quantity.");
assert.match(buildSource, /class="product-art slide-art \$\{soldOut \? "is-sold-out" : ""\}"/, "Server-rendered slider artwork must dim when unavailable.");
assert.match(buildSource, /soldOut \? '<span class="sold-out-label">Sold out<\/span>' : ""/, "Server-rendered home slider must include the Sold out label.");

const [storeSource, homeDocument] = await Promise.all([
  readFile(new URL("../public/data/public-store.json", import.meta.url), "utf8"),
  readFile(new URL("../dist/index.html", import.meta.url), "utf8")
]);
const store = JSON.parse(storeSource);
const soldOutRecentRelease = (store.products || []).find((product) => isRecentReleaseProduct(product) && productQuantity(product) === 0);
assert.ok(soldOutRecentRelease, "Fixture data must include a sold-out Recent Release for the rendered home-slider check.");
const productId = String(soldOutRecentRelease.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
assert.match(
  homeDocument,
  new RegExp(`data-product-id="${productId}"[\\s\\S]{0,700}<span class="sold-out-label">Sold out</span>`),
  "Generated home HTML must label a sold-out slider item before client JavaScript runs."
);

console.log("Home slider sold-out state contract passed.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculatePackages } from "../api/_lib/shippingCalculator.js";

const store = JSON.parse(await readFile(new URL("../public/data/public-store.json", import.meta.url), "utf8"));
const products = (store.products || []).filter((product) => product.publishStatus === "Published" && product.visibility === "Public");
const failures = [];
const privateOverrideProducts = [];
for (const product of products) {
  try {
    const result = calculatePackages([{ product, quantity: 1 }]);
    assert.ok(result.packages.length >= 1);
    assert.ok(result.packages.every((pkg) => pkg.chargeableWeightKg >= 1));
  } catch (error) {
    if (String(error?.message || "").startsWith("SHIPPING_PROFILE_REQUIRED") && ["Objects", "Publishing"].includes(product.category)) {
      privateOverrideProducts.push(product.sku || product.id);
      continue;
    }
    failures.push(`${product.sku || product.id}: ${error instanceof Error ? error.message : error}`);
  }
}
if (failures.length) throw new Error(`Shipping profiles failed:\n${failures.join("\n")}`);
console.log(`Shipping profiles verified for ${products.length - privateOverrideProducts.length} public products; ${privateOverrideProducts.length} private manual override profile(s) stay server-only.`);

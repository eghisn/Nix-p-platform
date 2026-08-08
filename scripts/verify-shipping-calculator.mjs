import assert from "node:assert/strict";
import { calculatePackages, priceShippingOptions } from "../api/_lib/shippingCalculator.js";
import { tariffCacheFallback } from "../api/_lib/nixpShippingEngine.js";

const product = (id, format, title = format, extra = {}) => ({ id, sku: id.toUpperCase(), category: format === "Vinyl" || format === "CD" || format === "Cassette" ? "Records" : "Apparel", format, title, ...extra });

const vinyl = calculatePackages([{ product: product("v1", "Vinyl"), quantity: 4 }]);
assert.equal(vinyl.packages.length, 2);
assert.deepEqual(vinyl.packages.map((pkg) => [pkg.lengthCm, pkg.widthCm, pkg.heightCm]), [[34, 34, 8], [34, 34, 4]]);
assert.equal(vinyl.totalChargeableWeightKg, 3);

const mixedMedia = calculatePackages([
  { product: product("cd", "CD"), quantity: 3 },
  { product: product("tape", "Cassette"), quantity: 4 }
]);
assert.equal(mixedMedia.packages.length, 1);
assert.equal(mixedMedia.packages[0].packingPoints, 24);
assert.equal(mixedMedia.packages[0].chargeableWeightKg, 1);

const apparel = calculatePackages([
  { product: product("tee", "Apparel", "T-Shirt"), quantity: 1 },
  { product: product("hood", "Apparel", "Hoodie"), quantity: 2 }
]);
assert.equal(apparel.packages.length, 2);
assert.deepEqual(apparel.packages.map((pkg) => pkg.packingPoints), [5, 4]);

const caps = calculatePackages([{ product: product("cap", "Apparel", "Cap"), quantity: 4 }]);
assert.equal(caps.packages.length, 2);
assert.deepEqual(caps.packages.map((pkg) => pkg.chargeableWeightKg), [4, 2]);

const rings = calculatePackages([{ product: product("ring", "Object", "Silver Ring", { category: "Objects" }), quantity: 17 }]);
assert.deepEqual(rings.packages.map((pkg) => pkg.chargeableWeightKg), [2, 1]);

const manual = calculatePackages([{ product: product("obj", "Object", "Object", { category: "Objects", shipping: { manualShippingOverride: true, weightGrams: 1200, lengthCm: 20, widthCm: 20, heightCm: 20 } }), quantity: 2 }]);
assert.equal(manual.packages.length, 2);
assert.equal(manual.packages[0].manualShippingOverride, true);

const options = priceShippingOptions(vinyl, [
  { id: "one", origin: "Jakarta", courier: "JNE", service: "REG", chargeable_weight_kg: 1, rate: 20000, effective_date: "2026-01-01", active: true },
  { id: "two", origin: "Jakarta", courier: "JNE", service: "REG", chargeable_weight_kg: 2, rate: 35000, effective_date: "2026-01-01", active: true }
], { origin: "Jakarta" });
assert.equal(options.length, 1);
assert.equal(options[0].shippingTotal, 55000);

const fetchedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
const staleCache = [{
  id: "CGK-BDO-1-REG",
  status: "available",
  service_code: "REG",
  service_name: "REG",
  shipment_type: "Document/Paket",
  chargeable_weight_kg: 1,
  rate: 12000,
  estimated_days_min: 1,
  estimated_days_max: 2,
  fetched_at: fetchedAt,
  valid_until: fetchedAt,
  source: "JNE_OFFICIAL"
}];
const exactFallback = tariffCacheFallback(staleCache, 1, 2160);
assert.equal(exactFallback.cacheStatus, "stale");
assert.equal(exactFallback.services[0].rate, 12000);
const derivedFallback = tariffCacheFallback(staleCache, 2, 2160);
assert.equal(derivedFallback.cacheStatus, "derived-cache");
assert.equal(derivedFallback.services[0].rate, 24000);

console.log("Shipping calculator contract verified.");

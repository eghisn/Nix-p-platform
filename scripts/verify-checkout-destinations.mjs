import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { searchCheckoutDestinations, checkoutQuoteError } from "../src/data/checkoutDestinations.js";
import { calculatePackages } from "../api/_lib/shippingCalculator.js";

for (const [query, code] of [["Jakarta", "31.74"], ["Bandung", "32.73"], ["Surabaya", "35.78"], ["Yogya", "34.71"], ["Jogja", "34.71"], ["Bali", "51.71"], ["West Java", "32.73"], ["Jabar", "32.73"]]) {
  assert(searchCheckoutDestinations(query).some((region) => region.code === code), query);
}
assert.equal(searchCheckoutDestinations("Bandung")[0].code, "32.73");
assert.equal(searchCheckoutDestinations("YOGYA")[0].code, "34.71");
assert.equal(searchCheckoutDestinations("unlisted-city-xyz").length, 0);
assert(searchCheckoutDestinations("Bali").every((region) => region.province === "Bali"));
assert.match(checkoutQuoteError(500, "SHIPPING_PROFILE_REQUIRED: test"), /Shipping details for an item/);
assert.match(checkoutQuoteError(503), /retry/);
assert.match(checkoutQuoteError(429), /wait/);
assert.match(checkoutQuoteError(422), /destination/);
assert.doesNotMatch(checkoutQuoteError(500, "private database detail"), /private database/);

const testProduct = { id: "test", category: "Objects", format: "Object", shipping: { weightGrams: 100, lengthCm: 10, widthCm: 10, heightCm: 1 } };
assert.equal(calculatePackages([{ product: testProduct, quantity: 1 }]).totalChargeableWeightKg, 1);
assert.throws(() => calculatePackages([{ product: { ...testProduct, shipping: {} }, quantity: 1 }]), /SHIPPING_PROFILE_REQUIRED/);
const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(source, /const destinationCode = checkoutCity.value/);
assert.match(source, /const syncCheckoutProvince = \(\) => \{\s*\+\+checkoutQuoteRequest/);
assert.match(source, /requestId !== checkoutQuoteRequest \|\| !checkoutForm.isConnected/);
assert.match(source, /input.name && input.name !== "shippingAddress2"/);
assert(!source.includes("cityTypeahead"));
console.log("Checkout destination search, quote invalidation, safe errors, and test package verified.");

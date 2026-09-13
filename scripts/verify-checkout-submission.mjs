import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Execute the actual registered submit handler with a failing transport: no orders or emails.
const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const start = source.indexOf('  document.querySelector("[data-checkout-form]")?.addEventListener("submit"');
const end = source.indexOf('\n  const shippingMethod = document.querySelector', start);
assert(start > 0 && end > start);
let handler;
let payload;
let renders = 0;
let requests = 0;
let releaseCart;
const cartReady = new Promise((resolve) => { releaseCart = resolve; });
const quoteToken = `${"a".repeat(8)}-1234-1234-1234-${"b".repeat(12)}.${"c".repeat(48)}`;
const state = { checkoutShippingQuote: { quoteToken } };
const fields = new Map(Object.entries({ name: "Test", email: "test@example.com", whatsapp: "081234567890", shippingMethod: "JNE", shippingCity: "32.73", shippingOption: "JNE::REG", shippingAddress1: "Test address" }));
const button = { disabled: false };
const messages = [];
let changes = 0;
const form = { dataset: {}, querySelector: () => button, dispatchEvent: () => { changes++; } };
runInNewContext(source.slice(start, end), {
  document: { querySelector: () => ({ addEventListener: (_, callback) => { handler = callback; } }) },
  FormData: class { get(key) { return fields.get(key) || ""; } },
  Event: class {},
  state,
  indonesiaRegionByCode: new Map([["32.73", { code: "32.73", city: "Kota Bandung", province: "Jawa Barat" }]]),
  render: async () => { renders++; state.checkoutShippingQuote = null; },
  cartSummary: async () => { await cartReady; return { rows: [{ productId: "test-product", quantity: 1 }] }; },
  getCheckoutOrderToken: () => "order-test-12345678",
  checkoutMarketingAttribution: () => null,
  setFormMessage: (_, message) => messages.push(message),
  fetch: async (_, options) => { requests++; payload = JSON.parse(options.body); return { ok: false, json: async () => ({ error: "Controlled test failure" }) }; }
});
const event = { preventDefault() {}, currentTarget: form };
const first = handler(event);
assert.equal(form.dataset.submitting, "true");
await handler(event);
// A concurrent quote refresh must not replace the submitted quote snapshot.
state.checkoutShippingQuote = null;
releaseCart();
await first;
assert.equal(requests, 1, "Double click must not create two requests");
assert.equal(payload.shippingQuoteToken, quoteToken, "Submitted token must survive async work");
assert.equal(payload.shippingOption, "JNE::REG");
assert.equal(payload.shippingAddress.regionCode, "32.73");
assert.equal(renders, 0, "Submission/failure must not reset the form or shipping quote");
assert.equal(fields.get("shippingAddress1"), "Test address");
assert.equal(form.dataset.submitting, undefined);
assert.equal(changes, 1);
assert(messages.length >= 2);
console.log("Actual checkout submit handler verified: stable quote token, duplicate prevention, preserved form on failure.");

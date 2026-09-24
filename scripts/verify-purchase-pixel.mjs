import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { metaPurchaseSummary } from "../api/_lib/metaPurchase.js";

const order = {
  id: "order-synthetic-purchase-001",
  order_class: "Customer", payment_status: "Paid", currency: "IDR",
  merchandise_total: 260000, discount_total: 0, shipping_total: 10000, grand_total: 270000,
  items: [{ product_id: "nxp-2026-cst-0005", quantity: 1, unit_price: 260000, line_total: 260000 }]
};
const attempt = { status: "Paid", payload: {
  order_id: order.id, transaction_status: "settlement", fraud_status: "accept",
  payment_type: "bank_transfer", status_code: "200", gross_amount: "270000.00", currency: "IDR"
} };
const purchase = metaPurchaseSummary(order, attempt);
assert.deepEqual(purchase, {
  orderId: order.id, content_ids: ["nxp-2026-cst-0005"], content_type: "product",
  value: 260000, currency: "IDR", num_items: 1,
  contents: [{ id: "nxp-2026-cst-0005", quantity: 1, item_price: 260000 }]
});
for (const transaction_status of ["pending", "expire", "cancel", "deny", "failure", "authorize"]) {
  assert.equal(metaPurchaseSummary(order, { ...attempt, payload: { ...attempt.payload, transaction_status } }), null);
}
assert.equal(metaPurchaseSummary({ ...order, payment_status: "Pending" }, attempt), null);
assert.equal(metaPurchaseSummary({ ...order, order_class: "Test" }, attempt), null);
assert.equal(metaPurchaseSummary(order, { ...attempt, status: "Pending" }), null);
assert.equal(metaPurchaseSummary(order, { ...attempt, payload: { ...attempt.payload, gross_amount: "260000.00" } }), null);
assert.equal(metaPurchaseSummary(order, { ...attempt, payload: { ...attempt.payload, order_id: "order-mismatch" } }), null);
assert.equal(metaPurchaseSummary({ ...order, items: [] }, attempt), null);
assert.equal(metaPurchaseSummary({ ...order, items: [{ ...order.items[0], product_id: "" }] }, attempt), null);
assert.equal(metaPurchaseSummary({ ...order, items: [{ ...order.items[0], line_total: 250000 }] }, attempt), null);
assert.equal(metaPurchaseSummary(order, { ...attempt, payload: { ...attempt.payload, transaction_status: "capture", payment_type: "qris" } }), null);
assert.ok(metaPurchaseSummary(order, { ...attempt, payload: { ...attempt.payload, transaction_status: "capture", payment_type: "credit_card" } }));
assert.equal(metaPurchaseSummary(order, { ...attempt, payload: { ...attempt.payload, transaction_status: "capture", payment_type: "credit_card", fraud_status: "challenge" } }), null);

const calls = [];
const storage = new Map();
globalThis.window = {
  location: { hostname: "www.nix-p.com", pathname: "/order-status", search: "", hash: "" },
  fbq: (...args) => calls.push(args)
};
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value)
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { locks: { request: async (_key, callback) => callback() } }
});
globalThis.document = { createElement: () => ({}), getElementsByTagName: () => [], head: { appendChild: () => {} } };
const { trackMetaPageView, trackMetaPurchase } = await import("../src/services/metaPixel.js");
const count = () => calls.filter(([kind, event]) => kind === "track" && event === "Purchase").length;
assert.equal(await trackMetaPurchase(true, purchase), false, "No consent means no Purchase.");
assert.equal(count(), 0);
trackMetaPageView(true);
assert.equal(await trackMetaPurchase(true, null), false, "A thank-you URL alone cannot trigger Purchase.");
assert.equal(await trackMetaPurchase(true, purchase), true);
assert.equal(count(), 1);
assert.deepEqual(calls.find(([kind, event]) => kind === "track" && event === "Purchase")[2], {
  content_ids: purchase.content_ids, content_type: "product", value: 260000,
  currency: "IDR", num_items: 1, contents: purchase.contents
});
assert.equal(await trackMetaPurchase(true, purchase), false, "A rerender cannot send twice.");
assert.equal(count(), 1);
const freshModule = await import("../src/services/metaPixel.js?purchase-reload");
freshModule.trackMetaPageView(true);
assert.equal(await freshModule.trackMetaPurchase(true, purchase), false, "Storage must survive a page reload.");
assert.equal(count(), 1);
window.location.pathname = "/cart";
assert.equal(await trackMetaPurchase(true, { ...purchase, orderId: "order-another-valid-id" }), false);
assert.equal(count(), 1);
window.location.pathname = "/order-status";
trackMetaPageView(false);
assert.equal(await trackMetaPurchase(true, { ...purchase, orderId: "order-another-valid-id" }), false, "Revoked consent blocks Purchase.");
assert.equal(count(), 1);

const checkout = await readFile(new URL("../api/checkout.js", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(checkout, /purchase: metaPurchaseSummary\(order, attempt\)/);
assert.match(main, /data-meta-purchase/);
assert.match(main, /syncPaidPurchase\(\)/);
console.log("Meta Purchase canonical paid-order, negative-status, consent, payload and duplicate checks passed.");

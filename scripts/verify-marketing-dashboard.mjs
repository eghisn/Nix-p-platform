import assert from "node:assert/strict";
import { buildMarketingDashboard } from "../api/_lib/marketingDashboard.js";

const now = new Date().toISOString();
const old = new Date(Date.now() - 120 * 86400000).toISOString();
const dashboard = buildMarketingDashboard({
  days: 30,
  events: [
    { event_type: "page_view", anonymous_session_id: "a", page_path: "/records", source: "instagram", device_type: "mobile", country_code: "ID", occurred_at: now },
    { event_type: "product_view", anonymous_session_id: "a", page_path: "/records/item", product_id: "p1", source: "instagram", device_type: "mobile", country_code: "ID", occurred_at: now },
    { event_type: "add_to_cart", anonymous_session_id: "a", page_path: "/records/item", product_id: "p1", source: "instagram", device_type: "mobile", country_code: "ID", occurred_at: now },
    { event_type: "checkout_started", anonymous_session_id: "a", page_path: "/cart", source: "instagram", device_type: "mobile", country_code: "ID", occurred_at: now }
  ],
  orders: [
    { id: "o1", customer: { name: "Test", email: "test@example.com" }, grand_total: 500000, payment_status: "Paid", paid_at: now, created_at: now, updated_at: now },
    { id: "old", customer: { name: "Older", email: "older@example.com" }, grand_total: 900000, payment_status: "Paid", paid_at: old, created_at: old, updated_at: old }
  ],
  lines: [{ order_id: "o1", product_id: "p1", title: "Release", artist: "Artist", quantity: 1, line_total: 500000, created_at: now }]
});

assert.equal(dashboard.metrics.visitors, 1);
assert.equal(dashboard.metrics.paidOrders, 1);
assert.equal(dashboard.metrics.netSales, 500000);
assert.equal(dashboard.metrics.checkoutStarted, 1);
assert.equal(dashboard.products[0].title, "Release");
assert.equal(dashboard.products[0].sales, 500000);
assert.equal(dashboard.contacts.length, 2, "Contact database is all-time even when metrics use a range.");
assert.equal(dashboard.health.orderRows, 1, "Old orders must not leak into period metrics.");
assert.equal(dashboard.sources[0].source, "instagram");

console.log("Marketing dashboard aggregation verified.");

import assert from "node:assert/strict";
import { buildRollupMarketingDashboard } from "../api/_lib/marketingDashboard.js";
import { normalizeAnalyticsEvent, sameOriginAnalyticsRequest } from "../api/_lib/analytics.js";
import { normalizeMarketingAttribution } from "../api/_lib/marketingAttribution.js";

const dashboard = buildRollupMarketingDashboard({
  days: 7,
  fromDate: "2026-08-23",
  toDate: "2026-08-29",
  dailyRows: [{
    metric_date: "2026-08-29", sessions: 1, page_views: 2, product_views: 1, add_to_cart_count: 1,
    checkout_starts: 1, orders_paid: 2, gross_sales: 1_000_000, refunds: 1, refund_amount: 250_000,
    net_sales: 750_000, orders_expired: 1, orders_cancelled: 1
  }],
  sessionSummary: {
    metrics: { sessions: 1, pageViews: 2, productViews: 1, productClicks: 1, addToCart: 1, checkoutStarted: 1, productViewSessions: 1, addToCartSessions: 1, checkoutSessions: 1 },
    countries: [{ name: "ID", count: 4, share: 1 }], devices: [{ name: "mobile", count: 4, share: 1 }],
    sources: [{ source: "instagram", campaign: "launch", sessions: 1, views: 2, added: 1 }]
  },
  products: [{ id: "p1", title: "Release", artist: "Artist", views: 2, added: 1, orders: 2, units: 2, sales: 900_000 }],
  contactsSummary: { knownCustomers: 501, returningCustomers: 10, contacts: [{ name: "Test", email: "test@example.com", orders: 2, sales: 1_000_000, lastOrder: "2026-08-29T00:00:00Z" }] },
  recentEvents: [{ event_type: "page_view", anonymous_session_id: "a", page_path: "/records", source: "instagram", occurred_at: "2026-08-29T00:00:00Z" }],
  newestOrder: { updated_at: "2026-08-29T00:00:00Z" }
});

assert.equal(dashboard.metrics.visitors, 1);
assert.equal(dashboard.metrics.paidOrders, 2);
assert.equal(dashboard.metrics.cashNetSales, 750_000, "Partial refunds must subtract only the verified refund amount from cash net sales.");
assert.equal(dashboard.metrics.grossSales, 1_000_000);
assert.equal(dashboard.metrics.verifiedRefunds, 250_000);
assert.equal(dashboard.metrics.refundedOrders, 1);
assert.equal(dashboard.metrics.knownCustomers, 501, "Contacts must not silently truncate at the visible 500-row table limit.");
assert.equal(dashboard.products[0].title, "Release");
assert.equal(dashboard.products[0].sales, 900_000);
assert.equal(dashboard.contacts.length, 1);
assert.equal(dashboard.daily.length, 7, "The chart needs zero-filled reporting days.");
assert.equal(dashboard.orderOutcomes.expired, 1);
assert.equal(dashboard.orderOutcomes.cancelled, 1);
assert.equal(dashboard.metrics.checkoutCreatedRate, 1, "Checkout creation rate must be measured from consented checkout sessions, not all paid orders.");

const validEvent = {
  eventId: "2b6f2b09-4be9-4b58-8b81-0ace022ddd84",
  eventType: "product_view",
  sessionId: "e630f6ca-2f11-4d30-a2d6-9e2efba3283f",
  path: "/records/example-release",
  productId: "NXP-2026-VNL-0001",
  deviceType: "mobile"
};
assert.equal(normalizeAnalyticsEvent(validEvent).path, "/records/example-release");
assert.equal(normalizeAnalyticsEvent({ ...validEvent, eventType: "request_item_submitted", productId: "" }).eventType, "request_item_submitted");
assert.equal(normalizeAnalyticsEvent({ ...validEvent, eventType: "social_outbound_click", productId: "", label: "tiktok" }).label, "tiktok");
assert.throws(() => normalizeAnalyticsEvent({ ...validEvent, path: "/records/example-release?email=test@example.com" }), /Invalid analytics event/);
assert.throws(() => normalizeAnalyticsEvent({ ...validEvent, productId: "" }), /Product analytics events require a product/);
assert.equal(sameOriginAnalyticsRequest({ headers: { origin: "https://www.nix-p.com", host: "www.nix-p.com", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" } }), true);
assert.equal(sameOriginAnalyticsRequest({ headers: { host: "www.nix-p.com", "x-forwarded-proto": "https" } }), false);
assert.equal(sameOriginAnalyticsRequest({ headers: { origin: "https://attacker.example", host: "www.nix-p.com", "x-forwarded-proto": "https", "sec-fetch-site": "cross-site" } }), false);
assert.deepEqual(normalizeMarketingAttribution({ source: "l.instagram.com", medium: "SOCIAL", campaign: "AUGUST-LAUNCH" }), { source: "instagram", medium: "social", campaign: "august-launch", term: "", content: "", sessionId: "" });
assert.equal(normalizeMarketingAttribution({ source: "www.nix-p.com" }).source, "direct", "Internal navigation must never become a marketing source.");

console.log("Marketing dashboard rollup aggregation verified.");

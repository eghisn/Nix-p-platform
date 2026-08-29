import assert from "node:assert/strict";
import { buildRollupMarketingDashboard } from "../api/_lib/marketingDashboard.js";

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
assert.equal(dashboard.metrics.netSales, 750_000, "Partial refunds must subtract only the verified refund amount.");
assert.equal(dashboard.metrics.refundedOrders, 1);
assert.equal(dashboard.metrics.knownCustomers, 501, "Contacts must not silently truncate at the visible 500-row table limit.");
assert.equal(dashboard.products[0].title, "Release");
assert.equal(dashboard.products[0].sales, 900_000);
assert.equal(dashboard.contacts.length, 1);
assert.equal(dashboard.daily.length, 7, "The chart needs zero-filled reporting days.");
assert.equal(dashboard.orderOutcomes.expired, 1);
assert.equal(dashboard.orderOutcomes.cancelled, 1);

console.log("Marketing dashboard rollup aggregation verified.");

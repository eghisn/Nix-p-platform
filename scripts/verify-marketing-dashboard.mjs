import assert from "node:assert/strict";
import { buildContentPlanDashboard, buildRollupMarketingDashboard } from "../api/_lib/marketingDashboard.js";
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
  instagram: { status: "connected", message: "Latest post activity is refreshed automatically from Meta.", account: "NIXP Instagram", posts: [{ id: "post-1", caption: "New release", mediaType: "VIDEO", permalink: "https://www.instagram.com/reel/example/", timestamp: "2026-08-29T00:00:00Z", likes: 12, comments: 3, reach: 100, saves: 2, shares: 3 }] },
  contentPlans: [{
    id: "b2b4cb20-5ed8-4b0c-9d1f-2fc590a223b3", title: "Content A", content_type: "Reel", objective: "Store visits", status: "Published",
    planned_at: "2026-08-29", campaign: "august-launch", tracking_content: "content-a", destination_path: "/records",
    instagram_permalink: "https://www.instagram.com/p/example/", target_reach: 100, target_saves_shares: 10, target_profile_visits: 4, target_new_followers: 2, actual_profile_visits: 5, actual_new_followers: 1,
    target_likes: 10, target_comments: 2, target_sessions: 8,
    target_carts: 1, target_paid_orders: 1, target_revenue: 100000
  }],
  contentPerformance: [{ tracking_content: "content-a", sessions: 8, product_views: 5, carts: 2, checkouts: 1, paid_orders: 1, revenue: 125000 }],
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
assert.equal(dashboard.instagram.status, "connected");
assert.equal(dashboard.instagram.posts[0].likes, 12);
assert.equal(dashboard.contentPlans.length, 1);
assert.equal(dashboard.contentPlans[0].actual.sessions, 8);
assert.equal(dashboard.contentPlans[0].target.reach, 100);
assert.equal(dashboard.contentPlans[0].actual.reach, 100);
assert.equal(dashboard.contentPlans[0].actual.savesShares, 5);
assert.equal(dashboard.contentPlans[0].actual.profileVisits, 5, "A manually entered profile-visit result must be preserved.");
assert.equal(dashboard.contentPlans[0].actual.newFollowers, 1, "A manually entered follower result must be preserved.");
assert.equal(dashboard.contentPlans[0].instagramPostFound, true, "A saved /p/ URL must match Meta's canonical /reel/ URL for the same post.");
assert.equal(dashboard.contentPlans[0].actual.revenue, 125000);
assert.equal(dashboard.contentPlans[0].result, "Ahead");
assert.match(dashboard.contentPlans[0].trackingUrl, /utm_content=content-a/);

const plannedContent = buildContentPlanDashboard([{
  id: "251e214d-7702-4df6-b11b-a02352bbdd35", title: "Future post", content_type: "Feed post", objective: "Awareness", status: "Planned",
  tracking_content: "future-post", destination_path: "/", campaign: "", instagram_permalink: "", target_reach: 0, target_saves_shares: 0,
  target_profile_visits: 0, target_new_followers: 0, target_likes: 0, target_comments: 0,
  target_sessions: 0, target_carts: 0, target_paid_orders: 0, target_revenue: 0
}]);
assert.equal(plannedContent[0].result, "Planned", "Planned content must not be marked as underperforming before it is published.");

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

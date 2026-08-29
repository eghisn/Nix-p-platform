import { requireWorkspace } from "./auth.js";
import { consumeCommerceRateLimit, requestClientAddress } from "./commerce.js";
import { isSupabaseConfigured, supabaseFetch } from "./supabase.js";

const PAID = new Set(["paid", "settlement", "capture", "completed"]);
const REFUNDED = new Set(["refund", "refunded", "partial_refund", "partial-refund"]);

export async function handleMarketingDashboard(req, res, url) {
  if (req.method !== "GET") return respond(res, 405, { ok: false, error: "Method not allowed." });
  if (!requireWorkspace(req, res, "marketing")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return respond(res, 503, { ok: false, error: "Marketing data is not configured." });
  }
  const allowed = await consumeCommerceRateLimit("marketing-dashboard", requestClientAddress(req), { limit: 90, windowSeconds: 60 });
  if (!allowed) return respond(res, 429, { ok: false, error: "Too many dashboard requests." });

  const days = [7, 30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const encodedSince = encodeURIComponent(since);
  const [events, orders, lines] = await Promise.all([
    supabaseFetch(`marketing_events?select=event_type,anonymous_session_id,page_path,product_id,source,medium,campaign,country_code,device_type,occurred_at&occurred_at=gte.${encodedSince}&order=occurred_at.asc&limit=10000`, { service: true }),
    supabaseFetch("order_records?select=id,public_reference,customer,grand_total,merchandise_total,shipping_total,discount_total,order_status,payment_status,paid_at,created_at,updated_at&order=created_at.asc&limit=5000", { service: true }),
    supabaseFetch(`order_lines?select=order_id,product_id,sku,artist,title,quantity,line_total,created_at&created_at=gte.${encodedSince}&order=created_at.asc&limit=10000`, { service: true })
  ]);
  return respond(res, 200, { ok: true, dashboard: buildMarketingDashboard({ events, orders, lines, days }) });
}

export function buildMarketingDashboard({ events = [], orders = [], lines = [], days = 30 } = {}) {
  const sinceTime = Date.now() - days * 86400000;
  const periodOrders = orders.filter((order) => new Date(order.created_at || order.paid_at || 0).getTime() >= sinceTime);
  const paidOrders = periodOrders.filter((order) => PAID.has(normalize(order.payment_status)) || Boolean(order.paid_at));
  const refundedOrders = periodOrders.filter((order) => REFUNDED.has(normalize(order.payment_status)));
  const paidIds = new Set(paidOrders.map((order) => String(order.id)));
  const sessions = unique(events.map((event) => event.anonymous_session_id));
  const eventCount = (type) => events.filter((event) => event.event_type === type).length;
  const sessionCount = (type) => unique(events.filter((event) => event.event_type === type).map((event) => event.anonymous_session_id)).length;
  const netSales = paidOrders.reduce((sum, order) => sum + number(order.grand_total), 0) - refundedOrders.reduce((sum, order) => sum + number(order.grand_total), 0);
  const checkoutSessions = sessionCount("checkout_started");
  const cartSessions = sessionCount("add_to_cart");
  const productRows = aggregateProducts(events, lines.filter((line) => paidIds.has(String(line.order_id))));
  const sourceRows = aggregateSources(events);
  const daily = aggregateDaily(events, paidOrders, lines, days);
  const contacts = aggregateContacts(orders);
  const newestEvent = events.at(-1)?.occurred_at || null;
  const newestOrder = orders.at(-1)?.updated_at || orders.at(-1)?.created_at || null;

  return {
    rangeDays: days,
    generatedAt: new Date().toISOString(),
    metrics: {
      netSales,
      paidOrders: paidOrders.length,
      refundedOrders: refundedOrders.length,
      visitors: sessions.size,
      sessions: sessions.size,
      pageViews: eventCount("page_view"),
      productViews: eventCount("product_view"),
      productClicks: eventCount("product_click"),
      addToCart: eventCount("add_to_cart"),
      checkoutStarted: eventCount("checkout_started"),
      conversion: sessions.size ? paidOrders.length / sessions.size : 0,
      cartAbandonment: cartSessions ? Math.max(0, (cartSessions - checkoutSessions) / cartSessions) : 0,
      knownCustomers: contacts.length,
      returningCustomers: contacts.filter((contact) => contact.orders > 1).length
    },
    products: productRows.slice(0, 50),
    sources: sourceRows.slice(0, 50),
    countries: aggregateDimension(events, "country_code"),
    devices: aggregateDimension(events, "device_type"),
    funnel: [
      { label: "Sessions", value: sessions.size },
      { label: "Product views", value: sessionCount("product_view") },
      { label: "Add to cart", value: cartSessions },
      { label: "Checkout started", value: checkoutSessions },
      { label: "Paid orders", value: paidOrders.length }
    ],
    orderOutcomes: aggregateOrderOutcomes(periodOrders),
    contacts: contacts.slice(0, 500),
    events: events.slice(-50).reverse().map((event) => ({
      time: event.occurred_at,
      event: event.event_type,
      path: event.page_path,
      source: event.source || "direct",
      session: shortId(event.anonymous_session_id)
    })),
    daily,
    health: {
      eventRows: events.length,
      orderRows: periodOrders.length,
      newestEvent,
      newestOrder,
      eventLimitReached: events.length >= 10000
    }
  };
}

function aggregateProducts(events, paidLines) {
  const rows = new Map();
  const rowFor = (id, title = "Unknown product", artist = "") => {
    const key = String(id || `${artist}:${title}`);
    if (!rows.has(key)) rows.set(key, { id: key, title, artist, views: 0, added: 0, orders: 0, units: 0, sales: 0 });
    return rows.get(key);
  };
  events.forEach((event) => {
    if (!event.product_id) return;
    const row = rowFor(event.product_id, event.product_id);
    if (event.event_type === "product_view" || event.event_type === "product_click") row.views += 1;
    if (event.event_type === "add_to_cart") row.added += 1;
  });
  paidLines.forEach((line) => {
    const row = rowFor(line.product_id || line.sku, line.title || line.sku, line.artist || "");
    row.title = line.title || row.title;
    row.artist = line.artist || row.artist;
    row.orders += 1;
    row.units += number(line.quantity);
    row.sales += number(line.line_total);
  });
  return [...rows.values()].sort((a, b) => b.sales - a.sales || b.views - a.views);
}

function aggregateSources(events) {
  const rows = new Map();
  events.forEach((event) => {
    const source = event.source || "direct";
    const campaign = event.campaign || "";
    const key = `${source}\u0000${campaign}`;
    if (!rows.has(key)) rows.set(key, { source, campaign, sessions: new Set(), views: 0, added: 0 });
    const row = rows.get(key);
    if (event.anonymous_session_id) row.sessions.add(event.anonymous_session_id);
    if (event.event_type === "product_view" || event.event_type === "product_click") row.views += 1;
    if (event.event_type === "add_to_cart") row.added += 1;
  });
  return [...rows.values()].map((row) => ({ ...row, sessions: row.sessions.size })).sort((a, b) => b.sessions - a.sessions);
}

function aggregateContacts(orders) {
  const contacts = new Map();
  orders.forEach((order) => {
    const email = String(order.customer?.email || "").trim().toLowerCase();
    if (!email) return;
    if (!contacts.has(email)) contacts.set(email, { name: String(order.customer?.name || "").trim() || "Customer", email, orders: 0, sales: 0, lastOrder: null, marketingConsent: false });
    const contact = contacts.get(email);
    contact.orders += 1;
    if (PAID.has(normalize(order.payment_status)) || order.paid_at) contact.sales += number(order.grand_total);
    const date = order.paid_at || order.created_at;
    if (!contact.lastOrder || new Date(date) > new Date(contact.lastOrder)) contact.lastOrder = date;
  });
  return [...contacts.values()].sort((a, b) => new Date(b.lastOrder) - new Date(a.lastOrder));
}

function aggregateDimension(events, field) {
  const counts = new Map();
  events.forEach((event) => {
    const value = String(event[field] || "unknown").trim().toUpperCase();
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  const total = events.length || 1;
  return [...counts].map(([name, count]) => ({ name, count, share: count / total })).sort((a, b) => b.count - a.count);
}

function aggregateDaily(events, paidOrders, lines, days) {
  const rows = new Map();
  const orderTotals = new Map(paidOrders.map((order) => [String(order.id), number(order.grand_total)]));
  const ensure = (date) => {
    if (!rows.has(date)) rows.set(date, { date, sessions: new Set(), visitors: 0, pageViews: 0, productViews: 0, added: 0, checkouts: 0, orders: 0, sales: 0 });
    return rows.get(date);
  };
  events.forEach((event) => {
    const date = String(event.occurred_at || "").slice(0, 10);
    if (!date) return;
    const row = ensure(date);
    if (event.anonymous_session_id) row.sessions.add(event.anonymous_session_id);
    if (event.event_type === "page_view") row.pageViews += 1;
    if (event.event_type === "product_view") row.productViews += 1;
    if (event.event_type === "add_to_cart") row.added += 1;
    if (event.event_type === "checkout_started") row.checkouts += 1;
  });
  paidOrders.forEach((order) => {
    const date = String(order.paid_at || order.created_at || "").slice(0, 10);
    if (!date) return;
    const row = ensure(date);
    row.orders += 1;
    row.sales += orderTotals.get(String(order.id)) || 0;
  });
  return [...rows.values()].map((row) => ({ ...row, visitors: row.sessions.size, sessions: undefined })).sort((a, b) => a.date.localeCompare(b.date)).slice(-Math.min(days, 90));
}

function aggregateOrderOutcomes(orders) {
  const result = { paid: 0, unpaid: 0, expired: 0, cancelled: 0, refunded: 0 };
  orders.forEach((order) => {
    const payment = normalize(order.payment_status);
    const status = normalize(order.order_status);
    if (REFUNDED.has(payment)) result.refunded += 1;
    else if (PAID.has(payment) || order.paid_at) result.paid += 1;
    else if (status.includes("cancel")) result.cancelled += 1;
    else if (status.includes("expir") || payment.includes("expir")) result.expired += 1;
    else result.unpaid += 1;
  });
  return result;
}

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("cdn-cache-control", "no-store");
  res.setHeader("vercel-cdn-cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function unique(values) { return new Set(values.filter(Boolean)); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function shortId(value) { const text = String(value || ""); return text ? `${text.slice(0, 8)}...` : "-"; }

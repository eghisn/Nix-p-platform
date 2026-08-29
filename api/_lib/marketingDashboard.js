import { requireWorkspace } from "./auth.js";
import { consumeCommerceRateLimit, requestClientAddress } from "./commerce.js";
import { isSupabaseConfigured, supabaseFetch } from "./supabase.js";

const REPORTING_TIME_ZONE = "Asia/Jakarta";

export async function handleMarketingDashboard(req, res, url) {
  if (req.method !== "GET") return respond(res, 405, { ok: false, error: "Method not allowed." });
  if (!requireWorkspace(req, res, "marketing")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return respond(res, 503, { ok: false, error: "Marketing data is not configured." });
  }
  const allowed = await consumeCommerceRateLimit("marketing-dashboard", requestClientAddress(req), { limit: 90, windowSeconds: 60 });
  if (!allowed) return respond(res, 429, { ok: false, error: "Too many dashboard requests." });

  const days = [7, 30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const { fromDate, toDate } = reportingRange(days);
  const queryRange = `metric_date=gte.${fromDate}&metric_date=lte.${toDate}&order=metric_date.asc`;
  const eventSince = encodeURIComponent(`${fromDate}T00:00:00+07:00`);
  const [dailyRows, sessionPayload, productPayload, contactPayload, recentEvents, newestOrder] = await Promise.all([
    supabaseFetch(`marketing_daily_metrics?select=*&${queryRange}`, { service: true }),
    supabaseFetch("rpc/marketing_dashboard_session_summary", { method: "POST", service: true, body: { p_from_date: fromDate, p_to_date: toDate } }),
    supabaseFetch("rpc/marketing_dashboard_products", { method: "POST", service: true, body: { p_from_date: fromDate, p_to_date: toDate } }),
    supabaseFetch("rpc/marketing_dashboard_contacts_summary", { method: "POST", service: true, body: {} }),
    // This is only the latest-activity panel. Dashboard totals never read
    // raw event rows in the API, so a high-volume event stream cannot truncate metrics.
    supabaseFetch(`marketing_events?select=event_type,anonymous_session_id,page_path,source,occurred_at&occurred_at=gte.${eventSince}&order=occurred_at.desc&limit=50`, { service: true }),
    supabaseFetch("order_records?select=updated_at,created_at&order=updated_at.desc&limit=1", { service: true })
  ]);

  return respond(res, 200, {
    ok: true,
    dashboard: buildRollupMarketingDashboard({
      days,
      fromDate,
      toDate,
      dailyRows,
      sessionSummary: sessionPayload || {},
      products: productPayload || [],
      contactsSummary: contactPayload || {},
      recentEvents: recentEvents || [],
      newestOrder: newestOrder?.[0] || null
    })
  });
}

export function buildRollupMarketingDashboard({
  days = 30,
  fromDate,
  toDate,
  dailyRows = [],
  sessionSummary = {},
  products = [],
  contactsSummary = {},
  recentEvents = [],
  newestOrder = null
} = {}) {
  const sessionMetrics = sessionSummary.metrics || {};
  const totals = dailyRows.reduce((sum, row) => ({
    grossSales: sum.grossSales + number(row.gross_sales),
    refundAmount: sum.refundAmount + number(row.refund_amount),
    paidOrders: sum.paidOrders + number(row.orders_paid),
    refundedOrders: sum.refundedOrders + number(row.refunds),
    expired: sum.expired + number(row.orders_expired),
    cancelled: sum.cancelled + number(row.orders_cancelled)
  }), { grossSales: 0, refundAmount: 0, paidOrders: 0, refundedOrders: 0, expired: 0, cancelled: 0 });
  const sessions = number(sessionMetrics.sessions);
  const checkoutSessions = number(sessionMetrics.checkoutSessions);
  const cartSessions = number(sessionMetrics.addToCartSessions);
  const dailyByDate = new Map(dailyRows.map((row) => [String(row.metric_date), row]));
  const daily = calendarDates(fromDate, toDate).map((date) => {
    const row = dailyByDate.get(date) || {};
    return {
      date,
      visitors: number(row.sessions),
      pageViews: number(row.page_views),
      productViews: number(row.product_views),
      added: number(row.add_to_cart_count),
      checkouts: number(row.checkout_starts),
      orders: number(row.orders_paid),
      cashNetSales: number(row.net_sales)
    };
  });
  const eventRows = number(sessionMetrics.pageViews) + number(sessionMetrics.productViews) + number(sessionMetrics.productClicks) + number(sessionMetrics.addToCart) + number(sessionMetrics.checkoutStarted);

  return {
    rangeDays: days,
    generatedAt: new Date().toISOString(),
    metrics: {
      cashNetSales: totals.grossSales - totals.refundAmount,
      grossSales: totals.grossSales,
      verifiedRefunds: totals.refundAmount,
      paidOrders: totals.paidOrders,
      refundedOrders: totals.refundedOrders,
      visitors: sessions,
      sessions,
      pageViews: number(sessionMetrics.pageViews),
      productViews: number(sessionMetrics.productViews),
      productClicks: number(sessionMetrics.productClicks),
      addToCart: number(sessionMetrics.addToCart),
      checkoutStarted: number(sessionMetrics.checkoutStarted),
      conversion: sessions ? totals.paidOrders / sessions : 0,
      cartAbandonment: cartSessions ? Math.max(0, (cartSessions - checkoutSessions) / cartSessions) : 0,
      knownCustomers: number(contactsSummary.knownCustomers),
      returningCustomers: number(contactsSummary.returningCustomers)
    },
    products: Array.isArray(products) ? products : [],
    sources: Array.isArray(sessionSummary.sources) ? sessionSummary.sources : [],
    countries: Array.isArray(sessionSummary.countries) ? sessionSummary.countries : [],
    devices: Array.isArray(sessionSummary.devices) ? sessionSummary.devices : [],
    funnel: [
      { label: "Sessions", value: sessions },
      { label: "Product views", value: number(sessionMetrics.productViewSessions) },
      { label: "Add to cart", value: cartSessions },
      { label: "Checkout started", value: checkoutSessions },
      { label: "Paid orders", value: totals.paidOrders }
    ],
    orderOutcomes: { paid: totals.paidOrders, unpaid: 0, expired: totals.expired, cancelled: totals.cancelled, refunded: totals.refundedOrders },
    contacts: Array.isArray(contactsSummary.contacts) ? contactsSummary.contacts : [],
    events: recentEvents.map((event) => ({
      time: event.occurred_at,
      event: event.event_type,
      path: event.page_path,
      source: event.source || "direct",
      session: shortId(event.anonymous_session_id)
    })),
    daily,
    health: {
      eventRows,
      orderRows: totals.paidOrders + totals.refundedOrders + totals.expired + totals.cancelled,
      newestEvent: recentEvents[0]?.occurred_at || null,
      newestOrder: newestOrder?.updated_at || newestOrder?.created_at || null,
      rollupFrom: fromDate,
      rollupTo: toDate
    }
  };
}

function reportingRange(days) {
  const toDate = dateInTimeZone(new Date(), REPORTING_TIME_ZONE);
  return { fromDate: shiftDate(toDate, -(days - 1)), toDate };
}

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function calendarDates(fromDate, toDate) {
  const dates = [];
  for (let date = fromDate; date <= toDate; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("cdn-cache-control", "no-store");
  res.setHeader("vercel-cdn-cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortId(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 8)}...` : "-";
}

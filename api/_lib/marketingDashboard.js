import { requireWorkspace } from "./auth.js";
import { consumeCommerceRateLimit, requestClientAddress } from "./commerce.js";
import { isSupabaseConfigured, supabaseFetch } from "./supabase.js";
import { getInstagramInsights } from "./instagramInsights.js";
import { sameOriginAnalyticsRequest } from "./analytics.js";

const REPORTING_TIME_ZONE = "Asia/Jakarta";
const CONTENT_PLAN_TYPES = new Set(["Reel", "Feed post", "Carousel", "Story", "Other"]);
const CONTENT_PLAN_OBJECTIVES = new Set(["Awareness", "Community", "Store visits", "Conversion"]);
const CONTENT_PLAN_STATUSES = new Set(["Planned", "Published", "Archived"]);
const CONTENT_PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleMarketingDashboard(req, res, url) {
  if (!requireWorkspace(req, res, "marketing")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return respond(res, 503, { ok: false, error: "Marketing data is not configured." });
  }
  if (url.searchParams.get("resource") === "content-plans") return handleContentPlans(req, res, url);
  if (req.method !== "GET") return respond(res, 405, { ok: false, error: "Method not allowed." });
  const allowed = await consumeCommerceRateLimit("marketing-dashboard", requestClientAddress(req), { limit: 90, windowSeconds: 60 });
  if (!allowed) return respond(res, 429, { ok: false, error: "Too many dashboard requests." });

  const days = [1, 3, 7, 30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const requestedMonth = String(url.searchParams.get("month") || "");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? `${requestedMonth}-01` : null;
  const { fromDate, toDate } = reportingRange(days);
  const queryRange = `metric_date=gte.${fromDate}&metric_date=lte.${toDate}&order=metric_date.asc`;
  const eventSince = encodeURIComponent(`${fromDate}T00:00:00+07:00`);
  const [dailyRows, sessionPayload, productPayload, contactPayload, monthlyPayload, recentEvents, newestOrder, instagram, contentPlans, contentPerformance] = await Promise.all([
    supabaseFetch(`marketing_daily_metrics?select=*&${queryRange}`, { service: true }),
    supabaseFetch("rpc/marketing_dashboard_session_summary", { method: "POST", service: true, body: { p_from_date: fromDate, p_to_date: toDate } }),
    supabaseFetch("rpc/marketing_dashboard_products", { method: "POST", service: true, body: { p_from_date: fromDate, p_to_date: toDate } }),
    supabaseFetch("rpc/marketing_dashboard_contacts_summary", { method: "POST", service: true, body: {} }),
    supabaseFetch("rpc/marketing_dashboard_monthly_report", { method: "POST", service: true, body: month ? { p_month: month } : {} }),
    // This is only the latest-activity panel. Dashboard totals never read
    // raw event rows in the API, so a high-volume event stream cannot truncate metrics.
    supabaseFetch(`marketing_events?select=event_type,anonymous_session_id,page_path,source,occurred_at&occurred_at=gte.${eventSince}&order=occurred_at.desc&limit=50`, { service: true }),
    supabaseFetch("order_records?select=updated_at,created_at&order=updated_at.desc&limit=1", { service: true }),
    getInstagramInsights(),
    supabaseFetch("marketing_content_plans?select=*&order=planned_at.desc.nullslast,created_at.desc", { service: true }),
    supabaseFetch("rpc/marketing_dashboard_content_performance", { method: "POST", service: true, body: { p_from_date: fromDate, p_to_date: toDate } })
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
      monthlyReport: monthlyPayload || {},
      recentEvents: recentEvents || [],
      newestOrder: newestOrder?.[0] || null,
      instagram,
      contentPlans: contentPlans || [],
      contentPerformance: contentPerformance || []
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
  monthlyReport = {},
  recentEvents = [],
  newestOrder = null,
  instagram = {},
  contentPlans = [],
  contentPerformance = []
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
  const normalizedInstagram = {
    status: String(instagram.status || "setup_required"),
    message: String(instagram.message || "Instagram connection is not configured."),
    account: String(instagram.account || ""),
    posts: Array.isArray(instagram.posts) ? instagram.posts : []
  };

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
      checkoutCreatedRate: sessions ? checkoutSessions / sessions : 0,
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
    monthly: monthlyReport,
    instagram: normalizedInstagram,
    contentPlans: buildContentPlanDashboard(contentPlans, contentPerformance, normalizedInstagram.posts),
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

async function handleContentPlans(req, res, url) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return respond(res, 405, { ok: false, error: 'Method not allowed.' });
  const requestError = validateContentPlanMutation(req);
  if (requestError) return respond(res, requestError.status, { ok: false, error: requestError.message });
  const allowed = await consumeCommerceRateLimit('marketing-content-plan', requestClientAddress(req), { limit: 30, windowSeconds: 60 });
  if (!allowed) return respond(res, 429, { ok: false, error: 'Too many content plan changes. Please wait a moment.' });

  try {
    const id = String(url.searchParams.get('id') || '').trim();
    if (req.method === 'DELETE') {
      if (!CONTENT_PLAN_ID.test(id)) return respond(res, 400, { ok: false, error: 'Invalid content plan.' });
      const rows = await supabaseFetch(`marketing_content_plans?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', service: true });
      if (!rows?.length) return respond(res, 404, { ok: false, error: 'That content plan no longer exists.' });
      return respond(res, 200, { ok: true });
    }

    const plan = normalizeContentPlan(await readMarketingBody(req));
    if (req.method === 'POST') {
      const rows = await supabaseFetch('marketing_content_plans', { method: 'POST', service: true, body: plan });
      return respond(res, 201, { ok: true, plan: rows?.[0] || null });
    }
    if (!CONTENT_PLAN_ID.test(id)) return respond(res, 400, { ok: false, error: 'Invalid content plan.' });
    const rows = await supabaseFetch(`marketing_content_plans?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', service: true, body: { ...plan, updated_at: new Date().toISOString() } });
    if (!rows?.length) return respond(res, 404, { ok: false, error: 'That content plan no longer exists.' });
    return respond(res, 200, { ok: true, plan: rows?.[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Content plan could not be saved.';
    if (/duplicate key|unique constraint/i.test(message)) return respond(res, 409, { ok: false, error: 'That tracking ID is already used by another content plan.' });
    const status = Number(error?.statusCode || 500);
    return respond(res, status, { ok: false, error: status < 500 ? message : 'Content plan could not be saved. Please try again.' });
  }
}

function validateContentPlanMutation(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return { status: 415, message: 'Content plans must use JSON.' };
  if (!sameOriginAnalyticsRequest(req)) return { status: 403, message: 'Content plan origin is not allowed.' };
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > 8_192) return { status: 413, message: 'Content plan is too large.' };
  return null;
}

async function readMarketingBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8') || '{}');
    } catch {
      const error = new Error('Invalid content plan.');
      error.statusCode = 400;
      throw error;
    }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = typeof req.body === 'string' ? req.body : '';
  try {
    return JSON.parse(raw || '{}');
  } catch {
    const error = new Error('Invalid content plan.');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeContentPlan(value = {}) {
  const clean = (input, limit) => String(input || '').trim().replace(/\s+/g, ' ').slice(0, limit);
  const title = clean(value.title, 140);
  if (!title) {
    const error = new Error('Enter a content name.');
    error.statusCode = 400;
    throw error;
  }
  const contentType = clean(value.contentType, 40) || 'Reel';
  const objective = clean(value.objective, 40) || 'Store visits';
  const status = clean(value.status, 20) || 'Planned';
  if (!CONTENT_PLAN_TYPES.has(contentType) || !CONTENT_PLAN_OBJECTIVES.has(objective) || !CONTENT_PLAN_STATUSES.has(status)) {
    const error = new Error('Choose valid content plan options.');
    error.statusCode = 400;
    throw error;
  }
  const trackingContent = trackingKey(value.trackingContent || title);
  if (!trackingContent) {
    const error = new Error('Use a tracking ID with letters, numbers, hyphens, or underscores.');
    error.statusCode = 400;
    throw error;
  }
  const instagramPermalink = clean(value.instagramPermalink, 300);
  if (instagramPermalink && !validInstagramPermalink(instagramPermalink)) {
    const error = new Error('Instagram post URL must be a valid instagram.com link.');
    error.statusCode = 400;
    throw error;
  }
  const plannedAt = clean(value.plannedAt, 10);
  if (plannedAt && !/^\d{4}-\d{2}-\d{2}$/.test(plannedAt)) {
    const error = new Error('Choose a valid publish date.');
    error.statusCode = 400;
    throw error;
  }
  return {
    title,
    content_type: contentType,
    objective,
    status,
    planned_at: plannedAt || null,
    campaign: clean(value.campaign, 120).toLowerCase(),
    tracking_content: trackingContent,
    destination_path: destinationPath(value.destinationPath),
    instagram_permalink: instagramPermalink ? normalizeInstagramPermalink(instagramPermalink) : '',
    target_reach: targetNumber(value.targetReach),
    target_saves_shares: targetNumber(value.targetSavesShares),
    target_profile_visits: targetNumber(value.targetProfileVisits),
    target_new_followers: targetNumber(value.targetNewFollowers),
    actual_profile_visits: optionalActualNumber(value.actualProfileVisits),
    actual_new_followers: optionalActualNumber(value.actualNewFollowers),
    target_likes: targetNumber(value.targetLikes),
    target_comments: targetNumber(value.targetComments),
    target_sessions: targetNumber(value.targetSessions),
    target_carts: targetNumber(value.targetCarts),
    target_paid_orders: targetNumber(value.targetPaidOrders),
    target_revenue: targetNumber(value.targetRevenue)
  };
}

function targetNumber(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2_000_000_000) {
    const error = new Error('Targets must be positive whole numbers.');
    error.statusCode = 400;
    throw error;
  }
  return Math.floor(parsed);
}

function optionalActualNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2_000_000_000) {
    const error = new Error('Manual actuals must be positive whole numbers.');
    error.statusCode = 400;
    throw error;
  }
  return Math.floor(parsed);
}

function trackingKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function destinationPath(value) {
  const candidate = String(value || '/').trim() || '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    const error = new Error('Destination must be a path on nix-p.com, such as /records.');
    error.statusCode = 400;
    throw error;
  }
  try {
    const url = new URL(candidate, 'https://www.nix-p.com');
    if (url.origin !== 'https://www.nix-p.com') throw new Error();
    return url.pathname;
  } catch {
    const error = new Error('Destination must be a path on nix-p.com, such as /records.');
    error.statusCode = 400;
    throw error;
  }
}

function validInstagramPermalink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeInstagramPermalink(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}/`;
}

export function buildContentPlanDashboard(plans = [], performanceRows = [], instagramPosts = []) {
  const performance = new Map((Array.isArray(performanceRows) ? performanceRows : []).map((row) => [String(row.tracking_content || '').toLowerCase(), row]));
  const postByPermalink = new Map((Array.isArray(instagramPosts) ? instagramPosts : []).map((post) => [normalizeComparablePermalink(post.permalink), post]));
  return (Array.isArray(plans) ? plans : []).map((plan) => {
    const trackingContent = String(plan.tracking_content || '').toLowerCase();
    const row = performance.get(trackingContent) || {};
    const post = postByPermalink.get(normalizeComparablePermalink(plan.instagram_permalink));
    const target = {
      reach: number(plan.target_reach), savesShares: number(plan.target_saves_shares), profileVisits: number(plan.target_profile_visits), newFollowers: number(plan.target_new_followers),
      likes: number(plan.target_likes), comments: number(plan.target_comments), sessions: number(plan.target_sessions),
      carts: number(plan.target_carts), paidOrders: number(plan.target_paid_orders), revenue: number(plan.target_revenue)
    };
    const actual = {
      // Meta does not attribute these account-level outcomes to one post. Keep
      // only an intentional manual value; otherwise null is not a failed zero.
      reach: nullableNumber(post?.reach), savesShares: combinedMetric(post?.saves, post?.shares), profileVisits: nullableNumber(plan.actual_profile_visits), newFollowers: nullableNumber(plan.actual_new_followers),
      likes: number(post?.likes), comments: number(post?.comments), sessions: number(row.sessions), productViews: number(row.product_views),
      carts: number(row.carts), checkouts: number(row.checkouts), paidOrders: number(row.paid_orders), revenue: number(row.revenue)
    };
    const comparisons = [
      ['reach', target.reach, actual.reach], ['savesShares', target.savesShares, actual.savesShares], ['likes', target.likes, actual.likes], ['comments', target.comments, actual.comments], ['sessions', target.sessions, actual.sessions],
      ['carts', target.carts, actual.carts], ['paidOrders', target.paidOrders, actual.paidOrders], ['revenue', target.revenue, actual.revenue]
    ].filter(([, planned, result]) => planned > 0 && result !== null);
    const progress = comparisons.length ? comparisons.reduce((sum, [, planned, result]) => sum + Math.min(1.5, result / planned), 0) / comparisons.length : null;
    const campaign = String(plan.campaign || '').trim() || trackingContent;
    const destination = String(plan.destination_path || '/');
    const url = new URL(destination, String(process.env.NIXP_PUBLIC_SITE_URL || 'https://www.nix-p.com'));
    url.searchParams.set('utm_source', 'instagram');
    url.searchParams.set('utm_medium', 'social');
    url.searchParams.set('utm_campaign', campaign);
    url.searchParams.set('utm_content', trackingContent);
    return {
      id: String(plan.id || ''), title: String(plan.title || 'Untitled content'), contentType: String(plan.content_type || 'Other'),
      objective: String(plan.objective || 'Store visits'), status: String(plan.status || 'Planned'), plannedAt: plan.planned_at || null,
      campaign, trackingContent, destinationPath: destination, instagramPermalink: String(plan.instagram_permalink || ''), target, actual,
      progress, result: plan.status === 'Planned' ? 'Planned' : progress === null ? 'Tracking' : progress >= 1 ? 'Ahead' : progress >= 0.75 ? 'On track' : 'Needs attention',
      trackingUrl: url.toString(), instagramPostFound: Boolean(post)
    };
  });
}

function normalizeComparablePermalink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    // Meta may canonicalize the exact same media as /p/, /reel/, or /tv/.
    // Match its immutable shortcode rather than the presentation-specific path.
    const shortcode = url.pathname.match(/^\/(?:p|reel|tv)\/([^/?#]+)\/?$/i)?.[1];
    if (shortcode) return `instagram-media:${shortcode}`;
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}/`;
  } catch {
    return '';
  }
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

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function combinedMetric(...values) {
  const parsed = values.map(nullableNumber);
  return parsed.some((value) => value === null) ? null : parsed.reduce((sum, value) => sum + value, 0);
}

function shortId(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 8)}...` : "-";
}

import { json } from "./auth.js";
import { consumeCommerceRateLimit, requestClientAddress } from "./commerce.js";
import { recordSystemEvent } from "./observability.js";
import { isSupabaseConfigured, supabaseFetch } from "./supabase.js";

const EVENT_TYPES = new Set(["page_view", "product_view", "product_click", "add_to_cart", "cart_open", "checkout_started"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleAnalyticsEvent(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed." });
  if (!sameOriginRequest(req)) return json(res, 403, { ok: false, error: "Analytics origin is not allowed." });
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Analytics is not configured." });
  }

  try {
    const event = normalizeEvent(req.body);
    const allowed = await consumeCommerceRateLimit("analytics-event", requestClientAddress(req), { limit: 240, windowSeconds: 60 });
    if (!allowed) return json(res, 429, { ok: false, error: "Too many analytics events." });
    await supabaseFetch("marketing_events", {
      method: "POST",
      service: true,
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: [{
        event_id: event.eventId,
        event_type: event.eventType,
        anonymous_session_id: event.sessionId,
        page_path: event.path,
        product_id: event.productId || null,
        source: event.source || null,
        medium: event.medium || null,
        campaign: event.campaign || null,
        term: event.term || null,
        content: event.content || null,
        country_code: countryCode(req),
        device_type: event.deviceType,
        metadata: {}
      }]
    });
    return json(res, 202, { ok: true });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    if (status >= 500) await recordSystemEvent({ level: "warning", source: "analytics-api", req, error });
    return json(res, status, { ok: false, error: status === 400 ? error.message : "Analytics event was not accepted." });
  }
}

function normalizeEvent(body) {
  let value;
  try {
    value = typeof body === "string" ? JSON.parse(body || "{}") : body || {};
  } catch {
    const error = new Error("Invalid analytics event.");
    error.statusCode = 400;
    throw error;
  }
  const text = (input, limit) => String(input || "").trim().slice(0, limit);
  const event = {
    eventId: text(value.eventId, 64),
    eventType: text(value.eventType, 48),
    sessionId: text(value.sessionId, 64),
    path: text(value.path, 240),
    productId: text(value.productId, 160),
    source: text(value.source, 120),
    medium: text(value.medium, 120),
    campaign: text(value.campaign, 120),
    term: text(value.term, 120),
    content: text(value.content, 120),
    deviceType: text(value.deviceType, 16)
  };
  if (!UUID.test(event.eventId) || !UUID.test(event.sessionId) || !EVENT_TYPES.has(event.eventType) || !event.path.startsWith("/")) {
    const error = new Error("Invalid analytics event.");
    error.statusCode = 400;
    throw error;
  }
  if (!["mobile", "tablet", "desktop"].includes(event.deviceType)) event.deviceType = "unknown";
  return event;
}

function sameOriginRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  const host = String(req.headers.host || "").trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  return origin === `${proto}://${host}`;
}

function countryCode(req) {
  const value = String(req.headers["x-vercel-ip-country"] || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

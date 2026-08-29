import { json } from "./auth.js";
import { consumeCommerceRateLimit, requestClientAddress } from "./commerce.js";
import { recordSystemEvent } from "./observability.js";
import { isSupabaseConfigured, supabaseFetch } from "./supabase.js";

const EVENT_TYPES = new Set(["page_view", "product_view", "product_click", "add_to_cart", "cart_open", "checkout_started"]);
const PRODUCT_EVENT_TYPES = new Set(["product_view", "product_click", "add_to_cart"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MAX_EVENT_BYTES = 2_048;

export async function handleAnalyticsEvent(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed." });
  const requestError = validateAnalyticsRequest(req);
  if (requestError) return json(res, requestError.status, { ok: false, error: requestError.message });
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Analytics is not configured." });
  }

  try {
    const event = normalizeAnalyticsEvent(req.body);
    const allowed = await consumeCommerceRateLimit("analytics-event", requestClientAddress(req), { limit: 120, windowSeconds: 60 });
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

export function normalizeAnalyticsEvent(body) {
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
    path: normalizePath(value.path),
    productId: text(value.productId, 160),
    source: text(value.source, 120),
    medium: text(value.medium, 120),
    campaign: text(value.campaign, 120),
    term: text(value.term, 120),
    content: text(value.content, 120),
    deviceType: text(value.deviceType, 16)
  };
  if (!UUID.test(event.eventId) || !UUID.test(event.sessionId) || !EVENT_TYPES.has(event.eventType) || !event.path) {
    const error = new Error("Invalid analytics event.");
    error.statusCode = 400;
    throw error;
  }
  if (event.productId && !PRODUCT_ID.test(event.productId)) {
    const error = new Error("Invalid analytics product.");
    error.statusCode = 400;
    throw error;
  }
  if (PRODUCT_EVENT_TYPES.has(event.eventType) && !event.productId) {
    const error = new Error("Product analytics events require a product.");
    error.statusCode = 400;
    throw error;
  }
  if (!PRODUCT_EVENT_TYPES.has(event.eventType)) event.productId = "";
  if (!["mobile", "tablet", "desktop"].includes(event.deviceType)) event.deviceType = "unknown";
  return event;
}

function normalizePath(value) {
  const path = String(value || "").trim();
  if (!path || path.length > 240 || !path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return "";
  try {
    const parsed = new URL(path, "https://nix-p.invalid");
    return parsed.origin === "https://nix-p.invalid" && parsed.pathname === path ? path : "";
  } catch {
    return "";
  }
}

export function sameOriginAnalyticsRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin || origin === "null") return false;
  const host = String(req.headers.host || "").trim();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const fetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === `${proto}:` && parsed.host === host;
  } catch {
    return false;
  }
}

export function validateAnalyticsRequest(req) {
  if (!isJsonRequest(req)) return { status: 415, message: "Analytics requests must use JSON." };
  if (!sameOriginAnalyticsRequest(req)) return { status: 403, message: "Analytics origin is not allowed." };
  if (requestIsTooLarge(req)) return { status: 413, message: "Analytics event is too large." };
  return null;
}

function isJsonRequest(req) {
  return /^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""));
}

function requestIsTooLarge(req) {
  const value = Number(req.headers["content-length"]);
  return Number.isFinite(value) && value > MAX_EVENT_BYTES;
}

function countryCode(req) {
  const value = String(req.headers["x-vercel-ip-country"] || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

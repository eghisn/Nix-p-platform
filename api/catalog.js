import { getSession, json } from "./_lib/auth.js";
import { sendRequestNotification } from "./_lib/emailNotifications.js";
import { isSupabaseConfigured, loadStore, upsertRawRows } from "./_lib/supabase.js";
import { publicProductPath } from "../src/data/publicUrls.js";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "https://nix-p.com");
    if (req.method === "GET" && url.searchParams.get("action") === "product-redirect") {
      return handleLegacyProductRedirect(req, res, url.searchParams.get("id"));
    }
    if (!isSupabaseConfigured()) return json(res, 503, { ok: false, error: "Supabase is not configured." });
    if (req.method === "POST") return handleRequestItem(req, res);
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
    const privateScope = url.searchParams.get("scope") === "admin";
    const session = privateScope ? getSession(req) : null;
    if (privateScope && session?.workspace !== "admin") return json(res, 401, { ok: false, error: "Admin login required" });
    const protocol = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0];
    const host = String(req.headers?.host || "www.nix-p.com").split(",")[0];
    const publicSnapshotUrl = privateScope ? "" : `${protocol}://${host}/public/data/public-store.json`;
    const store = await loadStore({ privateScope, publicSnapshotUrl });
    catalogJson(res, 200, { ok: true, store }, { privateScope });
  } catch (error) {
    json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Catalog unavailable" });
  }
}

function catalogJson(res, status, payload, { privateScope = false } = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (privateScope) {
    res.setHeader("cache-control", "no-store");
  } else {
    res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
    res.setHeader("cdn-cache-control", "public, max-age=300, stale-while-revalidate=1800");
    res.setHeader("vercel-cdn-cache-control", "public, max-age=300, stale-while-revalidate=1800");
  }
  res.end(JSON.stringify(payload));
}

async function handleLegacyProductRedirect(req, res, id) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return json(res, 404, { ok: false, error: "Product not found." });
  const protocol = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(req.headers?.host || "www.nix-p.com").split(",")[0];
  const publicSnapshotUrl = `${protocol}://${host}/public/data/public-store.json`;
  let store;
  try {
    store = await loadStore({ privateScope: false, publicSnapshotUrl });
  } catch {
    const snapshotResponse = await fetch(`${publicSnapshotUrl}?redirect=${encodeURIComponent(cleanId)}`, { cache: "no-store" });
    if (!snapshotResponse.ok) return json(res, 404, { ok: false, error: "Product not found." });
    store = await snapshotResponse.json();
  }
  const product = (store.products || []).find((item) => item.id === cleanId);
  if (!product) return json(res, 404, { ok: false, error: "Product not found." });
  res.writeHead(308, {
    location: `${protocol}://${host}${publicProductPath(product)}`,
    "cache-control": "public, max-age=31536000, immutable"
  });
  res.end();
}

async function handleRequestItem(req, res) {
  const url = new URL(req.url, "https://nix-p.com");
  if (url.searchParams.get("action") !== "request-item") {
    return json(res, 404, { ok: false, error: "Unknown catalog action." });
  }
  if (!isTrustedOrigin(req)) return json(res, 403, { ok: false, error: "Request origin is not allowed." });
  const body = parseBody(req.body);
  if (String(body.company || "").trim()) return json(res, 400, { ok: false, error: "Request could not be submitted." });
  const request = normalizeRequest(body);
  await upsertRawRows("requests", request);
  const notification = await sendRequestNotification(request).catch((error) => ({
    delivered: false,
    error: error instanceof Error ? error.message : "Notification delivery failed."
  }));
  if (!notification.delivered) console.warn("Request notification not delivered", { requestId: request.id, reason: notification.reason || notification.error || "unknown" });
  return json(res, 201, { ok: true, request, notification });
}

function parseBody(body) {
  try {
    return typeof body === "string" ? JSON.parse(body || "{}") : body || {};
  } catch {
    const error = new Error("Invalid request data.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeRequest(body) {
  const artistName = cleanText(body.artistName, 160);
  const itemName = cleanText(body.itemName, 160);
  const format = cleanText(body.format, 48);
  const email = cleanText(body.email, 254).toLowerCase();
  const whatsapp = cleanText(body.whatsapp, 48);
  const notes = cleanText(body.notes, 2000);
  if (!artistName || !itemName || !format || !isEmail(email)) {
    const error = new Error("Artist, item title, format, and a valid email are required.");
    error.statusCode = 400;
    throw error;
  }
  return {
    id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    artistName,
    itemName,
    format,
    email,
    whatsapp,
    notes,
    status: "New",
    createdAt: new Date().toISOString()
  };
}

function cleanText(value, limit) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isTrustedOrigin(req) {
  const origin = String(req.headers?.origin || "").replace(/\/$/, "");
  return [
    "https://nix-p.com",
    "https://www.nix-p.com",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:4174",
    "http://127.0.0.1:4174"
  ].includes(origin);
}

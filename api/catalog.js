import { getSession, json } from "./_lib/auth.js";
import { sendCustomerOfferConfirmation, sendCustomerRequestConfirmation, sendOfferNotification, sendRequestNotification } from "./_lib/emailNotifications.js";
import { isSupabaseConfigured, loadStore, supabaseFetch, upsertRawRows } from "./_lib/supabase.js";
import { publicProductPath } from "../src/data/publicUrls.js";
import { renderCatalogPage } from "./_lib/catalogPage.js";
import { recordSystemEvent } from "./_lib/observability.js";
import { handleAnalyticsEvent } from "./_lib/analytics.js";
import { handleMarketingDashboard } from "./_lib/marketingDashboard.js";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "https://nix-p.com");
    if (req.method === "GET" && url.searchParams.get("action") === "product-redirect") {
      return await handleLegacyProductRedirect(req, res, url.searchParams.get("id"));
    }
    if (req.method === "GET" && url.searchParams.get("action") === "catalog-page") {
      return await renderCatalogPage(req, res, url);
    }
    if (url.searchParams.get("action") === "analytics") return await handleAnalyticsEvent(req, res);
    if (url.searchParams.get("action") === "marketing-dashboard") return await handleMarketingDashboard(req, res, url);
    if (!isSupabaseConfigured()) return json(res, 503, { ok: false, error: "Supabase is not configured." });
    if (req.method === "POST") return await handlePostAction(req, res);
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
    await recordSystemEvent({ source: "catalog-api", req, error, details: { method: req.method } });
    json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Catalog unavailable" });
  }
}

async function handlePostAction(req, res) {
  const action = new URL(req.url, "https://nix-p.com").searchParams.get("action");
  if (action === "request-item") return handleRequestItem(req, res);
  if (action === "make-offer") return handleMakeOffer(req, res);
  if (action === "offer-status") return handleOfferStatus(req, res);
  return json(res, 404, { ok: false, error: "Unknown catalog action." });
}

function catalogJson(res, status, payload, { privateScope = false } = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (privateScope) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("cdn-cache-control", "no-store");
    res.setHeader("vercel-cdn-cache-control", "no-store");
  } else {
    // This is a stable fallback URL, so it must follow the active deployment.
    // Public pages normally use their revisioned snapshot instead.
    res.setHeader("cache-control", "public, max-age=0, must-revalidate");
    res.setHeader("cdn-cache-control", "public, s-maxage=0, must-revalidate");
    res.setHeader("vercel-cdn-cache-control", "public, s-maxage=0, must-revalidate");
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
  const [internal, customer] = await Promise.all([
    sendRequestNotification(request).catch((error) => ({ delivered: false, error: error instanceof Error ? error.message : "Notification delivery failed." })),
    sendCustomerRequestConfirmation(request).catch((error) => ({ delivered: false, error: error instanceof Error ? error.message : "Customer confirmation delivery failed." }))
  ]);
  if (!internal.delivered) console.warn("Request notification not delivered", { requestId: request.id, reason: internal.reason || internal.error || "unknown" });
  if (!customer.delivered) console.warn("Request confirmation not delivered", { requestId: request.id, reason: customer.reason || customer.error || "unknown" });
  return json(res, 201, { ok: true, request, notification: { internal, customer } });
}

async function handleMakeOffer(req, res) {
  if (!isTrustedOrigin(req)) return json(res, 403, { ok: false, error: "Offer origin is not allowed." });
  const body = parseBody(req.body);
  if (String(body.company || "").trim()) return json(res, 400, { ok: false, error: "Offer could not be submitted." });
  const productId = cleanText(body.productId, 160);
  const productRows = await supabaseFetch(`products?select=*&id=eq.${encodeURIComponent(productId)}`, { service: true });
  const product = Array.isArray(productRows) ? productRows[0] : null;
  if (!product) {
    const error = new Error("This item was not found.");
    error.statusCode = 404;
    throw error;
  }
  const raw = product?.raw || {};
  const openToOffers = product?.open_to_offers === true || raw.open_to_offers === true;
  if (!openToOffers) {
    const error = new Error("This item is not currently open for offers.");
    error.statusCode = 404;
    throw error;
  }
  const minimum = integerAmount(product?.minimum_acceptable_offer ?? raw.minimumAcceptableOffer, "Minimum Acceptable Offer is not configured.");
  if (!minimum) {
    const error = new Error("This item is not currently open for offers.");
    error.statusCode = 404;
    throw error;
  }
  const name = cleanText(body.name, 160);
  const email = cleanText(body.email, 254).toLowerCase();
  const mobilePhone = cleanText(body.mobilePhone, 48);
  const offerAmount = integerAmount(body.offerAmount, "Enter a whole-number offer in rupiah.");
  if (!name || !isEmail(email) || !mobilePhone) {
    const error = new Error("Name, valid email, and mobile phone are required.");
    error.statusCode = 400;
    throw error;
  }
  if (offerAmount < minimum) {
    const error = new Error(`Offer must be at least ${formatRupiah(minimum)}.`);
    error.statusCode = 422;
    throw error;
  }
  const offer = {
    id: `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId,
    sku: cleanText(product.sku, 100),
    artistName: cleanText(product.artist, 160),
    itemName: cleanText(product.title, 160),
    name,
    email,
    mobilePhone,
    offerAmount,
    minimumAcceptableOffer: minimum,
    status: "New",
    createdAt: new Date().toISOString()
  };
  await upsertRawRows("offers", offer);
  const [internal, customer] = await Promise.all([
    sendOfferNotification(offer).catch((error) => ({ delivered: false, error: error instanceof Error ? error.message : "Notification delivery failed." })),
    sendCustomerOfferConfirmation(offer).catch((error) => ({ delivered: false, error: error instanceof Error ? error.message : "Customer confirmation delivery failed." }))
  ]);
  if (!internal.delivered) console.warn("Offer notification not delivered", { offerId: offer.id, reason: internal.reason || internal.error || "unknown" });
  if (!customer.delivered) console.warn("Offer confirmation not delivered", { offerId: offer.id, reason: customer.reason || customer.error || "unknown" });
  return json(res, 201, { ok: true, offer: { ...offer, notification: undefined }, notification: { internal, customer } });
}

async function handleOfferStatus(req, res) {
  const session = getSession(req);
  if (session?.workspace !== "admin" && session?.workspace !== "finance") return json(res, 401, { ok: false, error: "Private workspace login required." });
  const body = parseBody(req.body);
  const id = cleanText(body.id, 160);
  const status = cleanText(body.status, 32);
  const allowed = new Set(["New", "Reviewing", "Contacting", "Accepted", "Declined", "Closed"]);
  if (!id || !allowed.has(status)) return json(res, 400, { ok: false, error: "Offer status is invalid." });
  const currentRows = await supabaseFetch(`offers?select=*&id=eq.${encodeURIComponent(id)}`, { service: true });
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current) return json(res, 404, { ok: false, error: "Offer not found." });
  const raw = { ...(current.raw || {}), status, updatedAt: new Date().toISOString() };
  const updated = await supabaseFetch(`offers?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    service: true,
    body: { status, raw, updated_at: raw.updatedAt },
    prefer: "return=representation"
  });
  return json(res, 200, { ok: true, offer: updated?.[0]?.raw || { ...raw, id } });
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

function integerAmount(value, message) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
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

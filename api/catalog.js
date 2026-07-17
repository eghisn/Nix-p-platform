import { getSession, json } from "./_lib/auth.js";
import { isSupabaseConfigured, loadStore, upsertRawRows } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!isSupabaseConfigured()) return json(res, 503, { ok: false, error: "Supabase is not configured." });
  try {
    if (req.method === "POST") return handleRequestItem(req, res);
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
    const privateScope = new URL(req.url, "https://nix-p.com").searchParams.get("scope") === "admin";
    const session = getSession(req);
    if (privateScope && session?.workspace !== "admin") return json(res, 401, { ok: false, error: "Admin login required" });
    const store = await loadStore({ privateScope });
    json(res, 200, { ok: true, store });
  } catch (error) {
    json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Catalog unavailable" });
  }
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
  const notification = await sendRequestEmail(request).catch((error) => ({
    delivered: false,
    error: error instanceof Error ? error.message : "Notification delivery failed."
  }));
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

async function sendRequestEmail(request) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REQUEST_EMAIL_FROM;
  const to = process.env.REQUEST_NOTIFICATION_TO || "egihisni@nix-p.com";
  if (!apiKey || !from) return { delivered: false, reason: "email-not-configured" };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: request.email,
      subject: `NIXP request item: ${request.artistName} - ${request.itemName}`,
      text: requestEmailText(request),
      html: requestEmailHtml(request)
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Request notification could not be delivered.");
  return { delivered: true, id: payload.id || null };
}

function requestEmailText(request) {
  return [
    "New NIXP request item",
    `Artist: ${request.artistName}`,
    `Title / item: ${request.itemName}`,
    `Format: ${request.format}`,
    `Email: ${request.email}`,
    `WhatsApp: ${request.whatsapp || "Not provided"}`,
    `Notes: ${request.notes || "None"}`,
    `Request ID: ${request.id}`
  ].join("\n");
}

function requestEmailHtml(request) {
  return `<h1>New NIXP request item</h1><p><strong>Artist:</strong> ${escapeHtml(request.artistName)}<br><strong>Title / item:</strong> ${escapeHtml(request.itemName)}<br><strong>Format:</strong> ${escapeHtml(request.format)}<br><strong>Email:</strong> ${escapeHtml(request.email)}<br><strong>WhatsApp:</strong> ${escapeHtml(request.whatsapp || "Not provided")}<br><strong>Notes:</strong> ${escapeHtml(request.notes || "None")}<br><strong>Request ID:</strong> ${escapeHtml(request.id)}</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

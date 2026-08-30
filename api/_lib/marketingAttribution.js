const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOURCE_ALIASES = new Map([
  ["instagram.com", "instagram"], ["www.instagram.com", "instagram"], ["m.instagram.com", "instagram"], ["l.instagram.com", "instagram"], ["ig", "instagram"],
  ["tiktok.com", "tiktok"], ["www.tiktok.com", "tiktok"], ["vm.tiktok.com", "tiktok"], ["vt.tiktok.com", "tiktok"],
  ["facebook.com", "facebook"], ["www.facebook.com", "facebook"], ["m.facebook.com", "facebook"], ["l.facebook.com", "facebook"],
  ["youtube.com", "youtube"], ["www.youtube.com", "youtube"], ["m.youtube.com", "youtube"], ["youtu.be", "youtube"],
  ["x.com", "x"], ["www.x.com", "x"], ["twitter.com", "x"], ["www.twitter.com", "x"],
  ["google", "google"], ["bing", "bing"], ["direct", "direct"], ["none", "direct"], ["unknown", "direct"]
]);

export const MARKETING_EVENT_TYPES = new Set([
  "page_view",
  "product_view",
  "product_click",
  "add_to_cart",
  "cart_open",
  "checkout_started",
  "request_item_submitted",
  "offer_submitted",
  "social_outbound_click"
]);

export const PRODUCT_MARKETING_EVENT_TYPES = new Set(["product_view", "product_click", "add_to_cart"]);

function clean(value, limit = 120) {
  return String(value || "").trim().slice(0, limit);
}

function normalizedKey(value, limit = 120) {
  return clean(value, limit)
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMarketingSource(value) {
  const source = normalizedKey(value, 160).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (!source || source === "nix-p.com" || source.endsWith(".nix-p.com") || source === "localhost" || source.startsWith("127.0.0.1")) return "direct";
  if (SOURCE_ALIASES.has(source)) return SOURCE_ALIASES.get(source);
  if (source.startsWith("google.")) return "google";
  if (source.startsWith("bing.")) return "bing";
  return source.slice(0, 120);
}

export function normalizeMarketingAttribution(value = {}) {
  const source = normalizeMarketingSource(value.source);
  return {
    source,
    medium: normalizedKey(value.medium),
    campaign: normalizedKey(value.campaign),
    term: normalizedKey(value.term),
    content: normalizedKey(value.content),
    sessionId: UUID.test(clean(value.sessionId, 64)) ? clean(value.sessionId, 64) : ""
  };
}

export function validMarketingSessionId(value) {
  return UUID.test(clean(value, 64));
}

const CONSENT_COOKIE = "nixp_cookie_consent";
const ANALYTICS_SESSION_KEY = "nixp_analytics_session";
const ANALYTICS_ATTRIBUTION_KEY = "nixp_analytics_attribution";
const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const ANALYTICS_EVENT_TYPES = new Set([
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

let initialized = false;
let lastTrackedPath = "";

function readCookie(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

function consentValue() {
  return decodeURIComponent(readCookie(CONSENT_COOKIE));
}

function writeConsent(value) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function isPublicPage() {
  return !location.pathname.startsWith("/admin") && !location.pathname.startsWith("/finance") && location.pathname !== "/login";
}

function createUuid() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function analyticsSessionId() {
  let value = sessionStorage.getItem(ANALYTICS_SESSION_KEY);
  if (!value) {
    value = createUuid();
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, value);
  }
  return value;
}

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (!source || source === "nix-p.com" || source.endsWith(".nix-p.com") || source === "localhost" || source.startsWith("127.0.0.1")) return "direct";
  if (["instagram.com", "m.instagram.com", "l.instagram.com", "ig"].includes(source)) return "instagram";
  if (["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(source)) return "tiktok";
  if (["facebook.com", "m.facebook.com", "l.facebook.com"].includes(source)) return "facebook";
  if (["youtube.com", "m.youtube.com", "youtu.be"].includes(source)) return "youtube";
  if (["x.com", "twitter.com"].includes(source)) return "x";
  if (source.startsWith("google.")) return "google";
  if (source.startsWith("bing.")) return "bing";
  return source.slice(0, 120);
}

function campaignContext() {
  const existing = sessionStorage.getItem(ANALYTICS_ATTRIBUTION_KEY);
  if (existing) {
    try {
      const saved = JSON.parse(existing);
      if (saved && typeof saved === "object" && saved.source) return saved;
    } catch {}
  }
  const params = new URLSearchParams(location.search);
  const value = (name) => String(params.get(name) || "").trim().slice(0, 120);
  const referrerHost = (() => {
    try {
      return document.referrer ? new URL(document.referrer).hostname.slice(0, 160) : "";
    } catch {
      return "";
    }
  })();
  const attribution = {
    source: normalizeSource(value("utm_source") || referrerHost),
    medium: value("utm_medium").toLowerCase(),
    campaign: value("utm_campaign").toLowerCase(),
    term: value("utm_term").toLowerCase(),
    content: value("utm_content").toLowerCase()
  };
  sessionStorage.setItem(ANALYTICS_ATTRIBUTION_KEY, JSON.stringify(attribution));
  return attribution;
}

function deviceType() {
  const width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  return width <= 760 ? "mobile" : width <= 1180 ? "tablet" : "desktop";
}

function consentBanner() {
  return document.querySelector("[data-cookie-consent]");
}

function updateConsentBanner() {
  const banner = consentBanner();
  if (!banner) return;
  banner.hidden = Boolean(consentValue());
}

function currentProductId() {
  return document.querySelector("[data-product-id]")?.getAttribute("data-product-id") || "";
}

export function hasAnalyticsConsent() {
  return consentValue() === "analytics";
}

export function trackAnalytics(eventType, metadata = {}) {
  if (!isPublicPage() || !hasAnalyticsConsent() || !ANALYTICS_EVENT_TYPES.has(eventType)) return;
  const campaign = campaignContext();
  const payload = {
    eventId: createUuid(),
    eventType,
    sessionId: analyticsSessionId(),
    path: location.pathname.slice(0, 240),
    productId: String(metadata.productId || currentProductId() || "").slice(0, 160),
    label: String(metadata.label || "").slice(0, 120),
    deviceType: deviceType(),
    ...campaign
  };
  fetch("/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "same-origin",
    keepalive: true
  }).catch(() => undefined);
}

export function checkoutMarketingAttribution() {
  if (!isPublicPage() || !hasAnalyticsConsent()) return null;
  const campaign = campaignContext();
  return { sessionId: analyticsSessionId(), ...campaign };
}

export function trackCurrentPageView() {
  if (!isPublicPage() || !hasAnalyticsConsent()) return;
  const path = `${location.pathname}${location.search}`;
  if (path === lastTrackedPath) return;
  lastTrackedPath = path;
  trackAnalytics(location.pathname.match(/^\/(records|objects|apparel|accessories|publishing)\//) ? "product_view" : "page_view");
}

export function initializeAnalytics() {
  if (initialized) return;
  initialized = true;
  updateConsentBanner();
  document.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-cookie-consent-choice]");
    if (choice) {
      writeConsent(choice.dataset.cookieConsentChoice === "analytics" ? "analytics" : "essential");
      updateConsentBanner();
      trackCurrentPageView();
      return;
    }

    if (event.target.closest("[data-cookie-preferences]")) {
      event.preventDefault();
      const banner = consentBanner();
      if (banner) banner.hidden = false;
      return;
    }

    const addToCart = event.target.closest("[data-add-cart]");
    if (addToCart) {
      trackAnalytics("add_to_cart", { productId: addToCart.dataset.addCart });
      return;
    }
    if (event.target.closest("[data-cart-open]")) {
      trackAnalytics("cart_open");
      return;
    }
    const socialLink = event.target.closest("[data-social-link]");
    if (socialLink) {
      trackAnalytics("social_outbound_click", { label: socialLink.dataset.socialLink || "social" });
      return;
    }
    const outboundLink = event.target.closest("a[href]");
    if (outboundLink) {
      try {
        const hostname = new URL(outboundLink.href, location.href).hostname.toLowerCase();
        if (hostname === "wa.me" || hostname.endsWith("whatsapp.com")) trackAnalytics("social_outbound_click", { label: "whatsapp" });
      } catch {}
    }
    const productLink = event.target.closest("[data-product-link]");
    if (productLink) trackAnalytics("product_click", { productId: productLink.dataset.productId || "" });
  });
  trackCurrentPageView();
}

const PIXEL_ID = "1677704951025869";
const PIXEL_SCRIPT_URL = "https://connect.facebook.net/en_US/fbevents.js";

let initialized = false;
let consentGranted = false;
let lastPageViewUrl = "";
let lastViewedProductId = "";

function isStorefront() {
  const host = window.location.hostname.toLowerCase();
  return ["nix-p.com", "www.nix-p.com", "localhost", "127.0.0.1"].includes(host);
}

function initializePixel() {
  if (initialized) return;
  initialized = true;

  // The standard Meta bootstrap lives in this one module because the site's
  // production CSP deliberately disallows inline scripts.
  if (!window.fbq) {
    const fbq = function (...args) {
      if (fbq.callMethod) fbq.callMethod.apply(fbq, args);
      else fbq.queue.push(args);
    };
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];

    const script = document.createElement("script");
    script.async = true;
    script.src = PIXEL_SCRIPT_URL;
    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else document.head.appendChild(script);
  }

  window.fbq("init", PIXEL_ID);
}

export function trackMetaPageView(allowed) {
  if (!isStorefront()) return;
  if (!allowed) {
    if (consentGranted) window.fbq("consent", "revoke");
    consentGranted = false;
    lastPageViewUrl = "";
    lastViewedProductId = "";
    return;
  }

  // An order-status link can contain a temporary customer access token until
  // the app exchanges it. Never send that URL to a third party.
  if (window.location.pathname === "/order-status" &&
      (window.location.hash || new URLSearchParams(window.location.search).has("token"))) return;

  initializePixel();
  if (!consentGranted) {
    window.fbq("consent", "grant");
    consentGranted = true;
  }

  const url = `${window.location.pathname}${window.location.search}`;
  if (url === lastPageViewUrl) return;
  lastPageViewUrl = url;
  window.fbq("track", "PageView");
}

export function trackMetaViewContent(allowed, productId) {
  if (!isStorefront()) return;
  const id = String(productId || "").trim();
  if (!allowed || !consentGranted || !id) {
    lastViewedProductId = "";
    return;
  }
  if (id === lastViewedProductId) return;
  lastViewedProductId = id;
  window.fbq("track", "ViewContent", { content_ids: [id], content_type: "product" });
}

export function trackMetaAddToCart(allowed, product, quantity) {
  if (!isStorefront() || !allowed || !consentGranted || product?.open_to_offers === true) return;
  const id = String(product?.id || "").trim();
  const price = Number(product?.price);
  const value = price * quantity;
  if (!id || !Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(value)) return;
  window.fbq("track", "AddToCart", {
    content_ids: [id],
    content_name: `${product.artist} \u2014 ${product.title}`,
    content_type: "product",
    value,
    currency: "IDR",
    num_items: quantity
  });
}

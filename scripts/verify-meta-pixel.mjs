import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const insertedScripts = [];
const firstScript = { parentNode: { insertBefore: (script) => insertedScripts.push(script) } };
globalThis.document = {
  createElement: () => ({}),
  getElementsByTagName: () => [firstScript],
  head: { appendChild: (script) => insertedScripts.push(script) }
};
globalThis.window = {
  location: { hostname: "www.nix-p.com", pathname: "/records/product-a", search: "", hash: "" }
};

const { trackMetaAddToCart, trackMetaInitiateCheckout, trackMetaPageView, trackMetaViewContent } = await import("../src/services/metaPixel.js");
const calls = () => window.fbq?.queue || [];
const count = (kind, value) => calls().filter(([name, argument]) => name === kind && argument === value).length;

trackMetaPageView(false);
trackMetaViewContent(false, "product-a");
trackMetaAddToCart(false, { id: "product-a", price: 370000 }, 1);
assert.equal(insertedScripts.length, 0, "Pixel must not load before analytics consent.");

trackMetaPageView(true);
assert.equal(insertedScripts.length, 1, "Pixel script must load only once.");
assert.equal(insertedScripts[0].src, "https://connect.facebook.net/en_US/fbevents.js");
assert.equal(count("init", "1677704951025869"), 1);
assert.equal(count("track", "PageView"), 1, "Initial consented load needs one PageView.");
trackMetaViewContent(true, "product-a");
assert.equal(count("track", "ViewContent"), 1, "A direct product load needs one ViewContent.");
assert.deepEqual(calls().find(([name, event]) => name === "track" && event === "ViewContent")[2], {
  content_ids: ["product-a"], content_type: "product"
});
assert.equal(count("track", "AddToCart"), 0, "Opening a product must not send AddToCart.");
assert.equal(count("track", "InitiateCheckout"), 0, "Opening a product must not start checkout.");
const product = { id: "product-a", artist: "Artist", title: "Title", price: 370000 };
trackMetaAddToCart(true, product, 1);
assert.equal(count("track", "AddToCart"), 1);
assert.deepEqual(calls().find(([name, event]) => name === "track" && event === "AddToCart")[2], {
  content_ids: ["product-a"], content_name: "Artist \u2014 Title", content_type: "product",
  value: 370000, currency: "IDR", num_items: 1
});
trackMetaAddToCart(true, product, 2);
assert.equal(count("track", "AddToCart"), 2, "Separate successful cart actions need separate events.");
assert.equal(calls().filter(([name, event]) => name === "track" && event === "AddToCart")[1][2].value, 740000);
trackMetaAddToCart(false, product, 1);
trackMetaAddToCart(true, { ...product, open_to_offers: true }, 1);
trackMetaAddToCart(true, { ...product, price: 0 }, 1);
assert.equal(count("track", "AddToCart"), 2, "Rejected, offer-only and invalid-price items must not send AddToCart.");

trackMetaPageView(true);
trackMetaViewContent(true, "product-a");
assert.equal(count("track", "PageView"), 1, "A same-URL rerender must not count twice.");
assert.equal(count("track", "ViewContent"), 1, "A same-product rerender must not count twice.");
window.location.pathname = "/records";
trackMetaPageView(true);
trackMetaViewContent(true, "");
assert.equal(count("track", "PageView"), 2, "SPA navigation needs a PageView.");
assert.equal(count("track", "ViewContent"), 1, "A category page must not send ViewContent.");
window.location.search = "?letter=A";
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 3, "A different catalogue URL needs a PageView.");
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 3);

window.location.pathname = "/records/product-a";
window.location.search = "";
trackMetaPageView(true);
trackMetaViewContent(true, "product-a");
assert.equal(count("track", "ViewContent"), 2, "Returning to a product needs a new ViewContent.");
trackMetaPageView(true);
trackMetaViewContent(true, "product-a");
assert.equal(count("track", "ViewContent"), 2);
window.location.pathname = "/records/product-b";
trackMetaPageView(true);
trackMetaViewContent(true, "product-b");
assert.equal(count("track", "ViewContent"), 3, "Navigating to another product needs ViewContent.");

trackMetaPageView(false);
trackMetaViewContent(false, "product-b");
trackMetaAddToCart(true, product, 1);
assert.equal(count("track", "AddToCart"), 2, "Revoked consent must stop cart tracking.");
assert.equal(count("consent", "revoke"), 1, "Rejecting optional cookies must revoke consent.");
trackMetaPageView(true);
trackMetaViewContent(true, "product-b");
assert.equal(count("consent", "grant"), 2, "Accepting again must restore consent.");
assert.equal(count("track", "PageView"), 6, "Reaccepting must count the current page once.");
assert.equal(count("track", "ViewContent"), 4, "Reaccepting must count the current product once.");
assert.equal(count("init", "1677704951025869"), 1);
assert.equal(insertedScripts.length, 1);

trackMetaPageView(false);
trackMetaViewContent(false, "");
window.location.pathname = "/order-status";
window.location.search = "";
window.location.hash = "#order=example&token=secret";
trackMetaPageView(true);
trackMetaViewContent(true, "");
assert.equal(count("track", "PageView"), 6, "Customer access tokens must not be sent to Meta.");
window.location.hash = "";
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 7, "The clean order-status URL can be counted.");
assert.equal(count("track", "ViewContent"), 4, "Order status must not send ViewContent.");

const storage = new Map();
globalThis.location = window.location;
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value)
};
globalThis.fetch = async () => ({ ok: true });
document.cookie = "nixp_cookie_consent=analytics";
document.documentElement = { clientWidth: 1200 };
document.querySelector = (selector) => selector === "#app .product-detail[data-product-id]"
  ? { getAttribute: () => "product-c" }
  : null;
window.innerWidth = 1200;
const { syncCheckoutEntry, trackCurrentPageView } = await import("../src/services/analytics.js");
window.location.pathname = "/records/product-c";
trackCurrentPageView();
assert.equal(count("track", "ViewContent"), 5, "The app's page dispatcher must track visible product details.");
trackCurrentPageView();
assert.equal(count("track", "ViewContent"), 5, "The app's same-route rerender must not double-count.");
window.location.pathname = "/records";
trackCurrentPageView();
assert.equal(count("track", "ViewContent"), 5, "The app must not track a product on a category page.");
window.location.pathname = "/admin/preview/product/product-c";
trackCurrentPageView();
assert.equal(count("track", "ViewContent"), 5, "Admin previews must not send ViewContent.");

const checkoutPayload = {
  content_ids: ["product-a", "product-b"], content_type: "product",
  value: 1136000, currency: "IDR", num_items: 2
};
const checkoutForm = { dataset: { metaCheckout: JSON.stringify(checkoutPayload) } };
document.querySelector = (selector) => selector === "#app [data-checkout-form][data-meta-checkout]" ? checkoutForm : null;
window.location.pathname = "/cart";
syncCheckoutEntry();
assert.equal(count("track", "InitiateCheckout"), 0, "The checkout event needs active Pixel consent.");
trackCurrentPageView();
syncCheckoutEntry();
assert.equal(count("track", "InitiateCheckout"), 1, "A rendered, consented checkout starts once.");
assert.deepEqual(calls().find(([name, event]) => name === "track" && event === "InitiateCheckout")[2], checkoutPayload);
syncCheckoutEntry();
trackCurrentPageView();
syncCheckoutEntry();
assert.equal(count("track", "InitiateCheckout"), 1, "Rerenders and repeated checkout transitions must not count twice.");
window.location.pathname = "/records";
syncCheckoutEntry();
window.location.pathname = "/cart";
checkoutForm.dataset.metaCheckout = "null";
syncCheckoutEntry();
assert.equal(count("track", "InitiateCheckout"), 1, "An invalid cart must not initiate checkout.");
checkoutForm.dataset.metaCheckout = JSON.stringify(checkoutPayload);
syncCheckoutEntry();
assert.equal(count("track", "InitiateCheckout"), 2, "A new valid checkout entry counts once.");
window.location.pathname = "/records";
syncCheckoutEntry();
window.location.pathname = "/cart";
document.querySelector = () => null;
syncCheckoutEntry();
assert.equal(count("track", "InitiateCheckout"), 2, "An empty checkout page must not count.");
trackMetaInitiateCheckout(true, { ...checkoutPayload, value: 0 });
assert.equal(count("track", "InitiateCheckout"), 2, "Invalid checkout values must not be sent.");
trackMetaPageView(false);
trackMetaInitiateCheckout(true, checkoutPayload);
assert.equal(count("track", "InitiateCheckout"), 2, "Revoked consent must block checkout tracking.");

const privateModule = await import("../src/services/metaPixel.js?private-host");
window.location.hostname = "admin.nix-p.com";
delete window.fbq;
privateModule.trackMetaPageView(true);
privateModule.trackMetaViewContent(true, "private-product");
privateModule.trackMetaAddToCart(true, product, 1);
assert.equal(insertedScripts.length, 1, "Private hosts must not load the Pixel.");

const analyticsSource = await readFile(new URL("../src/services/analytics.js", import.meta.url), "utf8");
assert.match(analyticsSource, /trackMetaPageView\(allowed\)/);
assert.match(analyticsSource, /trackMetaViewContent\(allowed, productId\)/);
assert.doesNotMatch(analyticsSource, /event\.target\.closest\("\[data-add-cart\]"\)/, "A click alone must not track AddToCart.");
assert.match(analyticsSource, /#app \.product-detail\[data-product-id\]/);
const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const policies = config.headers.filter((entry) => entry.headers?.some((header) => header.key === "Content-Security-Policy"));
const csp = (entry) => entry.headers.find((header) => header.key === "Content-Security-Policy").value;
assert.match(csp(policies[0]), /script-src[^;]*https:\/\/connect\.facebook\.net/);
assert.match(csp(policies[0]), /img-src[^;]*https:\/\/www\.facebook\.com/);
assert.match(csp(policies[0]), /connect-src[^;]*https:\/\/www\.facebook\.com/);
for (const privatePolicy of policies.slice(1)) assert.doesNotMatch(csp(privatePolicy), /facebook\.com|facebook\.net/);

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
assert.equal((html.match(/<script type="module"/g) || []).length, 1, "The root shell must have one app entrypoint.");
assert.doesNotMatch(html, /fbevents\.js|facebook\.com\/tr/, "No consent-bypassing inline or noscript Pixel is allowed.");
const bundlePath = html.match(/<script type="module" src="([^"]+)"/)[1];
const bundle = await readFile(new URL(`../dist${bundlePath}`, import.meta.url), "utf8");
assert.equal((bundle.match(/1677704951025869/g) || []).length, 1, "The production bundle must contain one Pixel ID.");
assert.equal((bundle.match(/connect\.facebook\.net\/en_US\/fbevents\.js/g) || []).length, 1);

console.log("Meta Pixel PageView, ViewContent, AddToCart and InitiateCheckout consent, payload, routing and CSP checks passed.");

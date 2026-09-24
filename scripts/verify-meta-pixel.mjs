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
  location: { hostname: "www.nix-p.com", pathname: "/", search: "", hash: "" }
};

const { trackMetaPageView } = await import("../src/services/metaPixel.js");
const calls = () => window.fbq?.queue || [];
const count = (kind, value) => calls().filter(([name, argument]) => name === kind && argument === value).length;

trackMetaPageView(false);
assert.equal(insertedScripts.length, 0, "Pixel must not load before analytics consent.");

trackMetaPageView(true);
assert.equal(insertedScripts.length, 1, "Pixel script must load only once.");
assert.equal(insertedScripts[0].src, "https://connect.facebook.net/en_US/fbevents.js");
assert.equal(count("init", "1677704951025869"), 1);
assert.equal(count("track", "PageView"), 1, "Initial consented load needs one PageView.");

trackMetaPageView(true);
assert.equal(count("track", "PageView"), 1, "A same-URL rerender must not count twice.");
window.location.pathname = "/records";
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 2, "SPA navigation needs a PageView.");
window.location.search = "?letter=A";
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 3, "A different catalogue URL needs a PageView.");
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 3);

trackMetaPageView(false);
assert.equal(count("consent", "revoke"), 1, "Rejecting optional cookies must revoke consent.");
trackMetaPageView(true);
assert.equal(count("consent", "grant"), 2, "Accepting again must restore consent.");
assert.equal(count("track", "PageView"), 4, "Reaccepting must count the current page once.");
assert.equal(count("init", "1677704951025869"), 1);
assert.equal(insertedScripts.length, 1);

trackMetaPageView(false);
window.location.pathname = "/order-status";
window.location.search = "";
window.location.hash = "#order=example&token=secret";
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 4, "Customer access tokens must not be sent to Meta.");
window.location.hash = "";
trackMetaPageView(true);
assert.equal(count("track", "PageView"), 5, "The clean order-status URL can be counted.");

const privateModule = await import("../src/services/metaPixel.js?private-host");
window.location.hostname = "admin.nix-p.com";
delete window.fbq;
privateModule.trackMetaPageView(true);
assert.equal(insertedScripts.length, 1, "Private hosts must not load the Pixel.");

const analyticsSource = await readFile(new URL("../src/services/analytics.js", import.meta.url), "utf8");
assert.match(analyticsSource, /trackMetaPageView\(isPublicPage\(\) && hasAnalyticsConsent\(\)\)/);
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

console.log("Meta Pixel consent, PageView routing, deduplication and CSP checks passed.");

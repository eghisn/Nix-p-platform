import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { json } from "../api/_lib/auth.js";

const headers = new Map();
let body = "";
const response = {
  statusCode: 0,
  setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
  end(value) { body = value; }
};

json(response, 200, { ok: true });

assert.equal(response.statusCode, 200, "JSON responses must retain their explicit status.");
assert.equal(headers.get("cache-control"), "no-store", "API responses must never be cached.");
assert.equal(headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains", "API responses must enforce HTTPS for NIXP subdomains.");
assert.equal(headers.get("x-content-type-options"), "nosniff", "API responses must prevent MIME sniffing.");
assert.equal(headers.get("x-frame-options"), "DENY", "API responses must not be frameable.");
assert.equal(headers.get("referrer-policy"), "no-referrer", "API responses must not leak order or session URLs through referrers.");
assert.equal(headers.get("cross-origin-resource-policy"), "same-origin", "API responses must not be embeddable cross-origin.");
assert.match(headers.get("content-security-policy"), /default-src 'none'/, "JSON responses must have a restrictive CSP.");
assert.deepEqual(JSON.parse(body), { ok: true }, "Security headers must not change the JSON payload.");

const login = await readFile(new URL("../api/auth/login.js", import.meta.url), "utf8");
const auth = await readFile(new URL("../api/_lib/auth.js", import.meta.url), "utf8");
assert.match(login, /consumeCommerceRateLimit\("workspace-login", subject, \{ limit: 8, windowSeconds: 900 \}\)/, "Workspace login must use a server-side rate limit.");
assert.match(login, /Too many login attempts/, "Login throttling must return a clear retry response.");
assert.match(login, /hasSessionSecret\(\)/, "Login must fail closed when session signing is not configured.");
assert.match(auth, /NIXP_SESSION_SECRET is required for session signing/, "Session signing must require the dedicated secret.");
assert.doesNotMatch(auth, /NIXP_ADMIN_PASSWORD \|\||NIXP_FINANCE_PASSWORD \|\||nixp-local-session-secret/, "Session signing must never fall back to workspace credentials or a local default.");

const catalog = await readFile(new URL("../api/catalog.js", import.meta.url), "utf8");
const requestHandler = catalog.slice(catalog.indexOf("async function handleRequestItem"), catalog.indexOf("async function handleMakeOffer"));
const offerHandler = catalog.slice(catalog.indexOf("async function handleMakeOffer"), catalog.indexOf("async function handleOfferStatus"));
assert.match(requestHandler, /consumeCommerceRateLimit\("catalog-request-item", requestClientAddress\(req\), \{ limit: 5, windowSeconds: 900 \}\)/, "Request Item must have a server-side, per-client submission limit.");
assert.match(requestHandler, /Too many item requests/, "Request Item must return a clear retry response when limited.");
assert.ok(requestHandler.indexOf("consumeCommerceRateLimit") < requestHandler.indexOf('upsertRawRows("requests"'), "Request Item must be limited before a row or email can be created.");
assert.match(offerHandler, /consumeCommerceRateLimit\("catalog-make-offer", requestClientAddress\(req\), \{ limit: 6, windowSeconds: 900 \}\)/, "Make an Offer must have a server-side, per-client submission limit.");
assert.match(offerHandler, /Too many offers/, "Make an Offer must return a clear retry response when limited.");
assert.ok(offerHandler.indexOf("consumeCommerceRateLimit") < offerHandler.indexOf('upsertRawRows("offers"'), "Make an Offer must be limited before a row or email can be created.");

console.log("API security headers and public submission rate-limit contracts passed.");

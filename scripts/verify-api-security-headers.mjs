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
assert.match(login, /consumeCommerceRateLimit\("workspace-login", subject, \{ limit: 8, windowSeconds: 900 \}\)/, "Workspace login must use a server-side rate limit.");
assert.match(login, /Too many login attempts/, "Login throttling must return a clear retry response.");

console.log("API security headers and login throttling contract passed.");

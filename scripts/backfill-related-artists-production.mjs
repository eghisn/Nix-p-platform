import { RELATED_ARTIST_RESEARCH_VERSION } from "../api/_lib/catalogEnrichment.js";
import { readFile } from "node:fs/promises";

await loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args.baseUrl || "https://admin.nix-p.com").replace(/\/$/, "");
const limit = Number(args.limit || 0);
const cookie = await login();
const store = await adminRequest("/api/catalog?scope=admin", { method: "GET" });
const staleSkus = (store.store?.products || [])
  .filter((product) => product.category === "Records")
  .filter((product) => String(product.raw?.relatedArtistResearchVersion || "") !== RELATED_ARTIST_RESEARCH_VERSION)
  .map((product) => String(product.sku || "").trim())
  .filter(Boolean)
  .slice(0, limit > 0 ? limit : undefined);

console.log(`Backfill ${staleSkus.length} record(s) to ${RELATED_ARTIST_RESEARCH_VERSION}.`);
for (let index = 0; index < staleSkus.length; index += 25) {
  const skus = staleSkus.slice(index, index + 25);
  const result = await adminRequest("/api/admin/store?commerceAction=catalog-sync", {
    method: "POST",
    body: JSON.stringify({ skus, force: true, publishAfterResearch: false })
  });
  console.log(`[${index + skus.length}/${staleSkus.length}]`, JSON.stringify(result.report || result));
}

const deployment = await adminRequest("/api/admin/store?commerceAction=catalog-sync", {
  method: "POST",
  body: JSON.stringify({ action: "deploy-current" })
});
console.log(JSON.stringify({ version: RELATED_ARTIST_RESEARCH_VERSION, staleSkus, deployment }, null, 2));

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspace: "admin",
      username: process.env.NIXP_ADMIN_USERNAME,
      password: process.env.NIXP_ADMIN_PASSWORD
    })
  });
  if (!response.ok) throw new Error(`Admin login failed (${response.status}).`);
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.split(";")[0];
  if (!sessionCookie) throw new Error("Admin login did not return a session cookie.");
  return sessionCookie;
}

async function adminRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", cookie, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Admin request failed (${response.status}).`);
  return payload;
}

async function loadLocalEnv() {
  const env = await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => "");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  if (!process.env.NIXP_ADMIN_USERNAME || !process.env.NIXP_ADMIN_PASSWORD) {
    throw new Error("NIXP_ADMIN_USERNAME and NIXP_ADMIN_PASSWORD are required.");
  }
}

function parseArgs(values) {
  return Object.fromEntries(values.map((value) => {
    const [key, ...rest] = value.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

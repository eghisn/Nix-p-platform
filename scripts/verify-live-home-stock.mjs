import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homeAppMarkup } from "../src/components/homePage.js";

const [catalogApi, catalogPage, storeClient, config] = await Promise.all([
  readFile(new URL("../api/catalog.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_lib/catalogPage.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/adminStore.js", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8").then(JSON.parse)
]);

const homepageRewrite = config.rewrites.find((rewrite) => rewrite.source === "/");
assert.equal(homepageRewrite?.destination, "/api/catalog?action=home-page", "The homepage must render through the live-commerce server route.");
assert.match(catalogApi, /action.*home-page[\s\S]*?renderHomePage\(req, res\)/, "The catalog API must route the homepage request to its server renderer.");

const renderStart = catalogPage.indexOf("export async function renderHomePage");
const renderEnd = catalogPage.indexOf("export async function renderCatalogPage", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "The live homepage renderer is missing.");
const renderer = catalogPage.slice(renderStart, renderEnd);
assert.ok(renderer.indexOf("await verifiedPrices(") < renderer.indexOf("homeAppMarkup(catalogProducts)"), "Live stock must be verified before homepage HTML is generated.");
assert.match(renderer, /commerceVerified = verified\.length === products\.length/, "The page may skip client revalidation only after all snapshot products were verified.");
assert.match(storeClient, /nixp-commerce-verified[\s\S]*?renderedPublicProductIds\(\)/, "The client must reuse a live-verified homepage without a duplicate initial stock request.");

const product = { id: "nixp-test-zero", artist: "Domi & JD Beck", title: "Who Asked?", category: "Records", format: "Vinyl", year: 2026, qty: 0, image: "/cover.webp", publishStatus: "Published", visibility: "Public" };
const zeroStockMarkup = homeAppMarkup([product]);
assert.match(zeroStockMarkup, /data-product-id="nixp-test-zero"[\s\S]*?<span class="sold-out-label">Sold out<\/span>/, "Live zero stock must be Sold Out in the homepage HTML itself.");
const availableMarkup = homeAppMarkup([{ ...product, qty: 1 }]);
assert.doesNotMatch(availableMarkup, /class="slide is-sold-out"/, "In-stock products must not be marked Sold Out.");

const homeDocument = await readFile(new URL("../dist/home-fallback.html", import.meta.url), "utf8");
const snapshotUrl = homeDocument.match(/<meta name="nixp-catalog-snapshot" content="([^"]+)"/i)?.[1];
assert.ok(snapshotUrl, "The built homepage must reference its release snapshot.");
const snapshot = JSON.parse(await readFile(new URL(`../dist${snapshotUrl}`, import.meta.url), "utf8"));
const target = snapshot.products.find((item) => item.sku === "NXP-2026-VNL-0109");
assert.ok(target && target.qty > 0, "The regression fixture must reproduce the stale Domi & JD Beck snapshot.");
const originalFetch = globalThis.fetch;
const previousEnv = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  revision: process.env.VERCEL_GIT_COMMIT_SHA
};
process.env.SUPABASE_URL = "https://supabase-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.VERCEL_GIT_COMMIT_SHA = "local";
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.startsWith("/public/data/releases/")) {
    return new Response(JSON.stringify(snapshot), { status: 200 });
  }
  if (url.pathname.endsWith("/rest/v1/products")) {
    const ids = [...url.searchParams.get("id").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const rows = snapshot.products
      .filter((item) => ids.includes(item.id))
      .map((item) => ({ id: item.id, price: item.price, qty: item.sku === target.sku ? 0 : item.qty, sizes: item.sizes || [] }));
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  throw new Error(`Unexpected test request: ${url}`);
};

try {
  const { renderHomePage } = await import("../api/_lib/catalogPage.js");
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
  await renderHomePage({ headers: { host: "nixp.test", "x-forwarded-proto": "https" } }, response);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<meta name="nixp-commerce-verified" content="true"/);
  const escapedTargetId = target.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(response.body, new RegExp(`data-product-id="${escapedTargetId}"[\\s\\S]{0,500}<span class="sold-out-label">Sold out</span>`));
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [["SUPABASE_URL", previousEnv.url], ["SUPABASE_SERVICE_ROLE_KEY", previousEnv.key], ["VERCEL_GIT_COMMIT_SHA", previousEnv.revision]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

if (existsSync(new URL("../dist/index.html", import.meta.url))) {
  throw new Error("A static dist/index.html would bypass Vercel's live-stock homepage rewrite.");
}

console.log("Live homepage stock rendering contract passed.");

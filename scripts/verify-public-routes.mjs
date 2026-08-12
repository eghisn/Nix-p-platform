import fs from "node:fs/promises";
import path from "node:path";
import { artistCreditNames } from "../src/data/catalogIdentity.js";
import { publicProductPath } from "../src/data/publicUrls.js";
import { labelEntries } from "../src/data/labelCatalog.js";

const root = process.cwd();
const baseUrl = String(process.argv[2] || process.env.NIXP_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("Usage: node scripts/verify-public-routes.mjs https://www.nix-p.com");

const store = JSON.parse(await fs.readFile(path.join(root, "public", "data", "public-store.json"), "utf8"));
const products = (store.products || []).filter((product) => product.publishStatus === "Published" && product.visibility === "Public");
const sampleProduct = products.find((product) => product.category === "Records") || products[0];
const sampleArtist = artistCreditNames(sampleProduct?.artist || "")[0];
const artistSlug = String(sampleArtist || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const canonicalProductPath = sampleProduct ? publicProductPath(sampleProduct) : "/records";
const legacyProductPath = sampleProduct ? `/product/${sampleProduct.id}` : "/product/missing";
const sampleLabel = labelEntries(products)[0];
const paths = ["/records/", "/objects", "/apparel", "/publishing", "/labels", sampleLabel ? `/labels/${sampleLabel.slug}` : "/labels", `/artists/${artistSlug}/`, `${canonicalProductPath}/`, legacyProductPath, "/request-item", "/cart"];

for (const route of paths) {
  const response = await fetch(`${baseUrl}${route}`, { redirect: "follow", cache: "no-store" });
  const body = await response.text();
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  if (!/NIXP_APP_MARKER|src\/main\.js|assets\/app\.js/.test(body)) throw new Error(`${route} did not return the NIXP application shell`);
  if (route === "/records/" && (!body.includes("records-toolbar") || !body.includes("data-record-sort"))) {
    throw new Error("/records/ static markup does not match the interactive records controls.");
  }
  if (["/objects", "/publishing"].includes(route) && body.includes('<div class="toolbar"><h1>')) {
    throw new Error(`${route} static markup is still using the legacy category template.`);
  }
  if (route === "/apparel" && !body.includes("data-apparel-filter")) {
    throw new Error("/apparel static markup does not match the interactive apparel controls.");
  }
  if (route === "/labels" && !body.includes("labels-grid")) {
    throw new Error("/labels static markup does not contain the label directory.");
  }
  if (route.startsWith("/labels/") && !body.includes("product-grid")) {
    throw new Error(`${route} static markup does not contain the label product grid.`);
  }
  if (route.startsWith("/product/") && /rel="canonical"/i.test(body) && !body.includes(canonicalProductPath)) {
    throw new Error(`${route} did not expose the canonical product path`);
  }
  process.stdout.write(`${route} ${response.status}\n`);
}

const catalogResponse = await fetch(`${baseUrl}/api/catalog?scope=public`, { cache: "no-store" });
const catalogPayload = await catalogResponse.json();
const apiProduct = catalogPayload?.store?.products?.find((product) => product.id === sampleProduct?.id);
if (!apiProduct?.image) throw new Error("Public catalog API did not return a product image.");
if (/coverartarchive\.org/i.test(apiProduct.image)) throw new Error("Public catalog API returned a third-party Cover Art Archive image.");
process.stdout.write("Public API reconciliation passed.\n");

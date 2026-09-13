import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadStore, saveAdminProduct } from "../api/_lib/supabase.js";
import { LEGACY_VINYL_SIZE_BY_SKU, normalizeVinylSize } from "../src/data/vinylSize.js";

// These are deliberately explicit SKU decisions, derived from an already
// stated inch value in Edition. This script never infers LP, EP, or album size.
const VINYL_SIZE_BY_SKU = LEGACY_VINYL_SIZE_BY_SKU;

const expectedSkus = new Set(Object.keys(VINYL_SIZE_BY_SKU));
const writeLocal = process.argv.includes("--write-local");
const applyRemote = process.argv.includes("--apply-remote");

if (!writeLocal && !applyRemote) {
  throw new Error("Choose --write-local, --apply-remote, or both. Dry runs must be explicit.");
}

if (writeLocal) {
  // This is the only source snapshot shipped to visitors. The private Admin
  // snapshot is intentionally excluded from builds and is read from Supabase.
  const reports = [await updateSnapshot("public/data/public-store.json", { requireAll: true })];
  console.log(JSON.stringify({ local: reports }, null, 2));
}

if (applyRemote) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply-remote.");
  }
  const store = await loadStore({ privateScope: true });
  const products = store.products || [];
  const missing = [...expectedSkus].filter((sku) => !products.some((product) => product.sku === sku));
  assert.deepEqual(missing, [], `Remote Admin catalog is missing: ${missing.join(", ")}`);
  const updated = [];
  for (const product of products) {
    const size = VINYL_SIZE_BY_SKU[product.sku];
    if (!size) continue;
    assertExplicitEdition(product, size);
    if (normalizeVinylSize(product.vinylSize) === size) continue;
    const result = await saveAdminProduct({ ...product, vinylSize: size }, {
      expectedRevision: product.editRevision,
      actor: "vinyl-size-backfill"
    });
    updated.push({ sku: result.product.sku, vinylSize: result.product.vinylSize, revision: result.product.editRevision });
  }
  console.log(JSON.stringify({ remoteUpdated: updated, skipped: expectedSkus.size - updated.length }, null, 2));
}

async function updateSnapshot(path, { requireAll }) {
  const snapshot = JSON.parse(await readFile(path, "utf8"));
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const missing = [...expectedSkus].filter((sku) => !products.some((product) => product.sku === sku));
  if (requireAll) assert.deepEqual(missing, [], `${path} is missing: ${missing.join(", ")}`);
  let changed = 0;
  for (const product of products) {
    const size = VINYL_SIZE_BY_SKU[product.sku];
    if (!size) continue;
    assertExplicitEdition(product, size);
    if (normalizeVinylSize(product.vinylSize) === size) continue;
    product.vinylSize = size;
    changed += 1;
  }
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { path, changed, verified: expectedSkus.size - missing.length, absentFromSnapshot: missing.length };
}

function assertExplicitEdition(product, size) {
  assert.equal(product.category, "Records", `${product.sku} must remain a record.`);
  assert.equal(String(product.format || "").trim(), "Vinyl", `${product.sku} must remain Vinyl.`);
  const edition = String(product.edition || "");
  const explicitSize = new RegExp(`\\b${size}(?:\\s*[\"\\u2033]|[-\\s]*inch)`, "i");
  assert.match(edition, explicitSize, `${product.sku} lacks an explicit ${size}-inch Edition value.`);
}

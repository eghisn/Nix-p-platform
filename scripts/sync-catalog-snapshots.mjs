import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  CURATED_FINANCE_ENRICHMENTS,
  enrichFinanceCatalogProduct
} from "../api/_lib/catalogEnrichment.js";
import { readFinanceState, writeFinanceState } from "../api/_lib/financeState.js";
import { loadStore, supabaseFetch } from "../api/_lib/supabase.js";
import { canonicalProductArtist } from "../src/data/catalogIdentity.js";

if (process.argv.includes("--local")) {
  await applyCuratedEnrichmentsLocally();
  process.exit(0);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const state = await readFinanceState();
let financeChanged = false;
for (const stock of state.inventoryStock || []) {
  const enrichment = CURATED_FINANCE_ENRICHMENTS[String(stock.sku || "").toUpperCase()];
  if (!enrichment) continue;
  const next = {
    title: enrichment.title,
    edition: enrichment.edition || "",
    barcode: enrichment.barcode || "",
    catalogNumber: enrichment.catalogNumber || ""
  };
  for (const [key, value] of Object.entries(next)) {
    if (String(stock[key] || "") === String(value || "")) continue;
    stock[key] = value;
    financeChanged = true;
  }
}

// This purchase was entered as Vinyl even though both its SKU and stock row are
// CD. Correcting the source row prevents the next purchase sync from reverting it.
for (const purchase of state.inventory || []) {
  if (String(purchase.sku || "").toUpperCase() !== "NXP-2026-CD-0025") continue;
  if (purchase.itemType === "CD") continue;
  purchase.itemType = "CD";
  financeChanged = true;
}

if (financeChanged) await writeFinanceState(state);

const [adminStore, publicStore] = await Promise.all([
  loadStore({ privateScope: true }),
  loadStore({ privateScope: false })
]);

await mkdir("public/data", { recursive: true });
await Promise.all([
  writeJson("public/data/admin-store.json", adminStore),
  writeJson("public/data/public-store.json", publicStore)
]);

const publishedSkus = new Set(publicStore.products.map((product) => String(product.sku || "").toUpperCase()));
const missing = Object.keys(CURATED_FINANCE_ENRICHMENTS).filter((sku) => !publishedSkus.has(sku));
if (missing.length) throw new Error(`Catalog sync completed with unpublished curated SKUs: ${missing.join(", ")}`);

const rows = await supabaseFetch(
  `products?select=sku,publish_status,visibility,image&sku=in.(${Object.keys(CURATED_FINANCE_ENRICHMENTS)
    .map((sku) => `"${sku}"`)
    .join(",")})`,
  { service: true }
);
console.log(
  JSON.stringify(
    {
      financeChanged,
      adminProducts: adminStore.products.length,
      publicProducts: publicStore.products.length,
      verified: rows
    },
    null,
    2
  )
);

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function applyCuratedEnrichmentsLocally() {
  const adminStore = JSON.parse(await readFile("public/data/admin-store.json", "utf8"));
  const publicStore = JSON.parse(await readFile("public/data/public-store.json", "utf8"));
  const stockBySku = new Map(
    (adminStore.inventory || [])
      .filter((item) => item.origin === "finance-stock")
      .map((item) => [String(item.sku || "").toUpperCase(), item])
  );

  for (const [sku, enrichment] of Object.entries(CURATED_FINANCE_ENRICHMENTS)) {
    const productIndex = adminStore.products.findIndex((product) => String(product.sku || "").toUpperCase() === sku);
    if (productIndex < 0) throw new Error(`Local Admin snapshot is missing ${sku}.`);
    const product = adminStore.products[productIndex];
    const stock = stockBySku.get(sku) || {
      sku,
      item: product.format,
      itemCondition: product.condition,
      artist: product.artist,
      title: product.title,
      sellingPrice: product.price
    };
    Object.assign(stock, {
      title: enrichment.title,
      edition: enrichment.edition || "",
      barcode: enrichment.barcode || "",
      catalogNumber: enrichment.catalogNumber || ""
    });
    const row = toProductRow(product);
    const enriched = await enrichFinanceCatalogProduct(row, stock);
    adminStore.products[productIndex] = fromProductRow(enriched);
  }

  const artistNames = new Set((adminStore.artists || []).map((artist) => String(artist.name || "").toLowerCase()));
  for (const product of adminStore.products) {
    if (product.category !== "Records" || !product.artist || artistNames.has(product.artist.toLowerCase())) continue;
    adminStore.artists.push({
      id: slugify(product.artist),
      name: product.artist,
      status: "Published",
      sort: adminStore.artists.length + 1
    });
    artistNames.add(product.artist.toLowerCase());
  }

  const publicProducts = adminStore.products.filter(
    (product) =>
      product.publishStatus === "Published" &&
      product.visibility === "Public" &&
      product.image &&
      !product.image.includes("nixp-product-example")
  );
  const nextPublicStore = {
    ...publicStore,
    products: publicProducts,
    artists: (adminStore.artists || []).filter((artist) => artist.status === "Published"),
    collections: (adminStore.collections || []).filter((collection) => collection.status === "Published"),
    requests: [],
    orders: [],
    cashflow: [],
    inventory: []
  };

  await Promise.all([
    writeJson("public/data/admin-store.json", adminStore),
    writeJson("public/data/public-store.json", nextPublicStore)
  ]);

  console.log(
    JSON.stringify(
      {
        mode: "local",
        adminProducts: adminStore.products.length,
        publicProducts: nextPublicStore.products.length,
        enrichedSkus: Object.keys(CURATED_FINANCE_ENRICHMENTS)
      },
      null,
      2
    )
  );
}

function toProductRow(product) {
  return {
    id: product.id,
    sku: product.sku,
    title: product.title,
    artist: product.artist,
    category: product.category,
    format: product.format,
    display_format: product.displayFormat,
    apparel_type: product.apparelType,
    condition: product.condition,
    price: product.price,
    year: product.year,
    label: product.label,
    collection: product.collection,
    color: product.color,
    material: product.material,
    image: product.image,
    images: product.images || [],
    image_credits: product.imageCredits || [],
    tags: product.tags || [],
    details: product.details || [],
    sizes: product.sizes || [],
    description: product.description || "",
    qty: product.qty,
    publish_status: product.publishStatus,
    visibility: product.visibility,
    updated_at: product.updatedAt,
    raw: product
  };
}

function fromProductRow(row) {
  return {
    ...(row.raw || {}),
    id: row.id,
    sku: row.sku,
    title: row.title,
    artist: canonicalProductArtist({ ...row, artist: row.artist }),
    category: row.category,
    format: row.format,
    displayFormat: row.display_format,
    apparelType: row.apparel_type,
    condition: row.condition,
    price: row.price,
    year: row.year,
    label: row.label,
    collection: row.collection,
    color: row.color,
    material: row.material,
    image: row.image,
    images: row.images || [],
    imageCredits: row.image_credits || [],
    tags: row.tags || [],
    details: row.details || [],
    sizes: row.sizes || [],
    description: row.description || "",
    qty: row.qty,
    publishStatus: row.publish_status,
    visibility: row.visibility,
    updatedAt: row.updated_at
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

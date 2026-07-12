import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artistNames, cashflow, inventory, orders, products, requestItems } from "../src/data/sampleData.js";

const STORE_VERSION = "uniform-display-product-photos-2026-07-12";

const defaultCollections = [
  { id: "records", title: "Records", type: "Category", status: "Published", sort: 1 },
  { id: "objects", title: "Objects", type: "Category", status: "Published", sort: 2 },
  { id: "apparel", title: "Apparel", type: "Category", status: "Published", sort: 3 },
  { id: "publishing", title: "Publishing", type: "Category", status: "Published", sort: 4 }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function withDefaults(product) {
  return {
    publishStatus: "Published",
    visibility: "Public",
    updatedAt: "2026-07-11",
    ...product,
    tags: product.tags || [],
    details: product.details || [],
    sizes: normalizeSizes(product.sizes || []),
    collection: product.collection || product.label || "",
    color: product.color || "",
    material: product.material || ""
  };
}

function normalizeSizes(sizes) {
  return sizes
    .map((size) => {
      const quantity = Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1));
      return {
        label: String(size.label || "").trim(),
        quantity,
        soldOut: quantity <= 0
      };
    })
    .filter((size) => size.label);
}

const store = {
  version: STORE_VERSION,
  products: products.map(withDefaults),
  artists: [...new Set(artistNames)].sort((a, b) => a.localeCompare(b)).map((name, index) => ({
    id: slugify(name),
    name,
    bio: "",
    status: "Published",
    sort: index + 1
  })),
  collections: defaultCollections,
  requests: clone(requestItems),
  orders: clone(orders),
  cashflow: clone(cashflow),
  inventory: clone(inventory)
};

const publicStore = {
  version: STORE_VERSION,
  products: store.products.filter((product) => product.publishStatus === "Published" && product.visibility !== "Hidden"),
  artists: store.artists.filter((artist) => artist.status === "Published"),
  collections: store.collections.filter((collection) => collection.status === "Published"),
  requests: [],
  orders: [],
  cashflow: [],
  inventory: []
};

const outputDir = join(process.cwd(), "public", "data");
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "admin-store.json"), `${JSON.stringify(store, null, 2)}\n`);
await writeFile(join(outputDir, "public-store.json"), `${JSON.stringify(publicStore, null, 2)}\n`);

console.log("Seeded public/data/admin-store.json and public/data/public-store.json");

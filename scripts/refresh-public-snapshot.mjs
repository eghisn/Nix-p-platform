import { readFile, writeFile } from "node:fs/promises";

const endpoint = process.argv[2] || `https://www.nix-p.com/api/catalog?scope=public&snapshot=${Date.now()}`;
const response = await fetch(endpoint, { cache: "no-store" });
if (!response.ok) throw new Error(`Could not fetch the public catalog: ${response.status}`);

const payload = await response.json();
const store = payload?.store;
if (!store || !Array.isArray(store.products) || !Array.isArray(store.artists)) {
  throw new Error("The public catalog response is missing its store payload.");
}

const path = "public/data/public-store.json";
const current = JSON.parse(await readFile(path, "utf8"));
const next = {
  ...current,
  version: store.version || current.version,
  products: store.products,
  artists: store.artists,
  collections: store.collections || [],
  requests: [],
  orders: [],
  cashflow: [],
  inventory: []
};

await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
console.log(JSON.stringify({ products: next.products.length, artists: next.artists.length, collections: next.collections.length }));

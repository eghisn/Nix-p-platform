import { readFile, writeFile } from "node:fs/promises";

const results = JSON.parse(await readFile("backups/related-artists/latest-research.json", "utf8"));
const resultBySku = new Map(results.map((result) => [result.sku, result]));

for (const file of ["public/data/public-store.json", "public/data/admin-store.json"]) {
  const store = JSON.parse(await readFile(file, "utf8"));
  store.products = (store.products || []).map((product) => {
    const result = resultBySku.get(String(product.sku || "").trim().toUpperCase());
    if (!result) return product;
    return {
      ...product,
      relatedArtists: result.relatedArtists,
      relatedArtistEvidence: result.relatedArtistEvidence,
      relatedArtistsResearch: result.relatedArtistsResearch
    };
  });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`);
}

console.log(`Applied related-artist research to ${results.length} local catalogue products.`);

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { researchRelatedArtists } from "../api/_lib/catalogEnrichment.js";

const snapshot = JSON.parse(await readFile("public/data/public-store.json", "utf8"));
const records = (snapshot.products || [])
  .filter((product) => product.category === "Records")
  .filter((product) => String(product.sku || "").trim());
const requestedSkus = new Set(process.argv.filter((arg) => arg.startsWith("--sku=")).map((arg) => arg.slice(6).toUpperCase()));
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) || 0);
const selected = records
  .filter((product) => !requestedSkus.size || requestedSkus.has(String(product.sku).trim().toUpperCase()))
  .slice(0, limit > 0 ? limit : undefined);
const results = [];

for (const [index, product] of selected.entries()) {
  const research = await researchRelatedArtists({
    artist: product.artist,
    title: product.title,
    format: product.format,
    releaseId: product.musicBrainzReleaseId || ""
  });
  const relatedArtists = [...new Set((research.artists || []).map((value) => String(value).trim()).filter(Boolean))];
  results.push({
    sku: String(product.sku).trim().toUpperCase(),
    id: product.id,
    artist: product.artist,
    title: product.title,
    relatedArtists,
    relatedArtistEvidence: research.evidence || [],
    relatedArtistsResearch: research
  });
  console.log(`[${index + 1}/${selected.length}] ${product.sku}: ${research.status}${relatedArtists.length ? ` -> ${relatedArtists.join(", ")}` : ""}`);
}

await mkdir("backups/related-artists", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(`backups/related-artists/research-${stamp}.json`, `${JSON.stringify(results, null, 2)}\n`);
await writeFile("backups/related-artists/latest-research.json", `${JSON.stringify(results, null, 2)}\n`);

for (const file of ["public/data/public-store.json", "public/data/admin-store.json"]) {
  const store = JSON.parse(await readFile(file, "utf8"));
  const resultBySku = new Map(results.map((result) => [result.sku, result]));
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

console.log(JSON.stringify({
  processed: results.length,
  verified: results.filter((item) => item.relatedArtistsResearch.status === "verified").length,
  combined: results.filter((item) => item.relatedArtistsResearch.status === "combined").length,
  lastFm: results.filter((item) => item.relatedArtistsResearch.status === "lastfm").length,
  noVerifiedMatch: results.filter((item) => item.relatedArtistsResearch.status === "no-verified-match").length,
  withArtists: results.filter((item) => item.relatedArtists.length).length,
  output: "backups/related-artists/latest-research.json"
}, null, 2));

import { mkdir, writeFile } from "node:fs/promises";
import {
  RELATED_ARTIST_RESEARCH_VERSION,
  researchRelatedArtists,
  resolveRelatedArtistDisplay
} from "../api/_lib/catalogEnrichment.js";
import { readFinanceState } from "../api/_lib/financeState.js";
import { backupStore, loadStore, supabaseFetch } from "../api/_lib/supabase.js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const products = await supabaseFetch("products?select=*&category=eq.Records");
const financeState = await readFinanceState();
const stockBySku = new Map(
  (financeState.inventoryStock || []).map((stock) => [String(stock.sku || "").trim().toUpperCase(), stock])
);
const requestedSkus = new Set(process.argv.filter((arg) => arg.startsWith("--sku=")).map((arg) => arg.slice(6).toUpperCase()));
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) || 0);
const staleOnly = process.argv.includes("--stale-only");
const records = products
  .filter((product) => String(product.sku || "").trim())
  .filter((product) => !requestedSkus.size || requestedSkus.has(String(product.sku || "").trim().toUpperCase()))
  .filter((product) => !staleOnly || String(product.raw?.relatedArtistResearchVersion || "") !== RELATED_ARTIST_RESEARCH_VERSION)
  .slice(0, limit > 0 ? limit : undefined);
const backup = records.map((product) => ({
  id: product.id,
  sku: product.sku,
  relatedArtists: product.raw?.relatedArtists || [],
  relatedArtistEvidence: product.raw?.relatedArtistEvidence || [],
  relatedArtistsResearch: product.raw?.relatedArtistsResearch || null
}));
await backupStore("related-artists-before-refresh", { generatedAt: new Date().toISOString(), products: backup });
await mkdir("backups/related-artists", { recursive: true });
await writeFile(`backups/related-artists/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, `${JSON.stringify(backup, null, 2)}\n`);

const results = [];
for (const [index, product] of records.entries()) {
  const sku = String(product.sku || "").trim().toUpperCase();
  const stock = stockBySku.get(sku) || {};
  const raw = product.raw || {};
  const releaseId = String(raw.musicBrainzReleaseId || product.musicBrainzReleaseId || "").trim();
  const research = await researchRelatedArtists({
    artist: product.artist || stock.artist,
    title: product.title || stock.title,
    format: product.format || stock.item,
    releaseId
  });
  const manual = Array.isArray(raw.manualRelatedArtists) ? raw.manualRelatedArtists : [];
  const relatedArtists = resolveRelatedArtistDisplay({
    manualRelatedArtists: manual,
    automaticRelatedArtists: research.artists || [],
    manualRelatedArtistsOverride: raw.manualRelatedArtistsOverride === true
  }).relatedArtists;
  const nextRaw = {
    ...raw,
    relatedArtists,
    relatedArtistEvidence: research.evidence || [],
    relatedArtistsResearch: research,
    relatedArtistResearchVersion: RELATED_ARTIST_RESEARCH_VERSION,
    autoEditorial: {
      ...(raw.autoEditorial || {}),
      relatedArtists,
      relatedArtistEvidence: research.evidence || [],
      relatedArtistsResearch: research,
      relatedArtistResearchVersion: RELATED_ARTIST_RESEARCH_VERSION
    }
  };
  if (String(raw.enrichmentStatus || "").startsWith("complete")) {
    nextRaw.enrichmentStatus = relatedArtists.length ? "complete" : "complete-no-related-artists";
  }
  await supabaseFetch(`products?id=eq.${encodeURIComponent(product.id)}`, {
    method: "PATCH",
    body: { raw: nextRaw, updated_at: new Date().toISOString().slice(0, 10) },
    service: true,
    prefer: "return=minimal"
  });
  results.push({
    sku,
    artist: product.artist,
    title: product.title,
    status: research.status,
    relatedArtists,
    evidence: research.evidence?.length || 0,
    releaseId: research.releaseId || ""
  });
  console.log(`[${index + 1}/${records.length}] ${sku}: ${research.status}${relatedArtists.length ? ` -> ${relatedArtists.join(", ")}` : ""}`);
}

const [adminStore, publicStore] = await Promise.all([
  loadStore({ privateScope: true }),
  loadStore({ privateScope: false })
]);
await Promise.all([
  writeFile("public/data/admin-store.json", `${JSON.stringify(adminStore, null, 2)}\n`),
  writeFile("public/data/public-store.json", `${JSON.stringify(publicStore, null, 2)}\n`),
  writeFile("backups/related-artists/last-refresh.json", `${JSON.stringify(results, null, 2)}\n`)
]);

console.log(JSON.stringify({
  processed: results.length,
  verified: results.filter((item) => item.status === "verified").length,
  noVerifiedMatch: results.filter((item) => item.status === "no-verified-match").length,
  withArtists: results.filter((item) => item.relatedArtists.length).length
}, null, 2));

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

import assert from "node:assert/strict";
import { enrichFinanceCatalogProduct, inventoryFingerprint } from "../api/_lib/catalogEnrichment.js";
import { applyCatalogPublicationSafety, isRecordPublicationReady } from "../src/data/catalogPublication.js";

const stock = {
  sku: "NXP-2026-CD-0025",
  item: "CD",
  itemCondition: "New-Sealed",
  artist: "Gorguts",
  title: "Pleiades' Dust",
  sellingPrice: 273000
};

const draft = {
  id: "finance-nxp-2026-cd-0025",
  sku: stock.sku,
  category: "Records",
  format: stock.item,
  condition: stock.itemCondition,
  price: stock.sellingPrice,
  raw: {}
};

const enriched = await enrichFinanceCatalogProduct(draft, stock, {
  catalogArtists: [{ artist: "Meshuggah", label: "Season of Mist" }]
});

assert.equal(enriched.publish_status, "Published");
assert.equal(enriched.visibility, "Public");
assert.match(enriched.image, /^\/public\//);
assert.ok(enriched.description.length > 40);
assert.ok(enriched.raw.reviewQuote);
assert.ok(enriched.raw.relatedArtists.includes("Meshuggah"));
assert.equal(enriched.raw.enrichmentStatus, "complete");
assert.equal(enriched.raw.enrichmentFingerprint, inventoryFingerprint(stock));

const privateStock = {
  ...stock,
  sellingPrice: 0,
  listingMode: "Private Collection / Offer Only",
  minimumAcceptableOffer: 500000
};
const privateEnriched = await enrichFinanceCatalogProduct(
  { ...draft, price: 0, open_to_offers: true, minimum_acceptable_offer: 500000 },
  privateStock,
  { catalogArtists: [{ artist: "Meshuggah", label: "Season of Mist" }] }
);
assert.equal(privateEnriched.open_to_offers, true);
assert.equal(privateEnriched.price, 0);
assert.equal(privateEnriched.minimum_acceptable_offer, 500000);
assert.equal(privateEnriched.publish_status, "Published");
assert.equal(privateEnriched.visibility, "Public");
assert.ok(privateEnriched.raw.enrichmentAttemptedAt);

const missingIdentity = await enrichFinanceCatalogProduct(draft, { ...stock, title: "", sellingPrice: 0 });
assert.equal(missingIdentity.publish_status, "Draft");
assert.equal(missingIdentity.visibility, "Private");
assert.equal(missingIdentity.raw.enrichmentStatus, "needs-finance-data");

const timStock = {
  sku: "NXP-2026-CD-0045",
  item: "CD",
  itemCondition: "Used Excellent",
  artist: "Tim Hecker",
  title: "Konoyo",
  sellingPrice: 280000
};
const tim = await enrichFinanceCatalogProduct(
  { ...draft, id: "finance-nxp-2026-cd-0045", sku: timStock.sku, raw: {} },
  timStock,
  { catalogArtists: [{ artist: "Oneohtrix Point Never", label: "Warp Records" }, { artist: "Nala Sinephro", label: "Warp Records" }] }
);
assert.equal(tim.publish_status, "Published");
assert.equal(tim.raw.enrichmentStatus, "complete");
assert.equal(tim.raw.reviewSource, "Pitchfork (quoted)");
assert.deepEqual(tim.raw.relatedArtists, ["Oneohtrix Point Never", "Nala Sinephro"]);
assert.equal(tim.images.length, 1, "Used records must not receive an invented product mockup.");
assert.equal(isRecordPublicationReady({ ...tim, ...tim.raw }), true);

const unsafeStore = applyCatalogPublicationSafety({
  products: [{ ...tim.raw, id: tim.id, financeStockId: "stock-1", publishStatus: "Published", visibility: "Public", reviewQuote: "", reviewSource: "", reviewUrl: "" }]
});
assert.equal(unsafeStore.products[0].publishStatus, "Draft");
assert.equal(unsafeStore.products[0].visibility, "Private");
assert.ok(unsafeStore.products[0].raw.publicationIssues.includes("review"));

process.stdout.write("Finance catalog enrichment contract passed.\n");

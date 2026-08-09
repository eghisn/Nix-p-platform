import assert from "node:assert/strict";
import { enrichFinanceCatalogProduct, inventoryFingerprint } from "../api/_lib/catalogEnrichment.js";

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

const missingIdentity = await enrichFinanceCatalogProduct(draft, { ...stock, title: "", sellingPrice: 0 });
assert.equal(missingIdentity.publish_status, "Draft");
assert.equal(missingIdentity.visibility, "Private");
assert.equal(missingIdentity.raw.enrichmentStatus, "needs-finance-data");

process.stdout.write("Finance catalog enrichment contract passed.\n");

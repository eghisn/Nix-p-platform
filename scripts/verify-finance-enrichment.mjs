import assert from "node:assert/strict";
import {
  CURATED_EDITORIAL_OVERRIDES,
  applyCuratedEditorialOverride,
  enrichFinanceCatalogProduct,
  inventoryFingerprint
} from "../api/_lib/catalogEnrichment.js";
import {
  applyCatalogPublicationSafety,
  isResearchPublicationReady,
  isRecordPublicationReady,
  recordPublicationIssues
} from "../src/data/catalogPublication.js";

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
assert.equal(enriched.raw.shipping.packagingGroup, "SMALL_MEDIA");
assert.equal(enriched.raw.shipping.weightGrams, 120);

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
assert.equal(tim.raw.shipping.shippingClass, "small-media-cd-bubble");
assert.equal(isRecordPublicationReady({ ...tim, ...tim.raw }), true);

const buttechnoStock = {
  sku: "NXP-2026-VNL-0044",
  item: "Vinyl",
  itemCondition: "New-Unsealed",
  artist: "Buttechno",
  title: "Day Of My Death",
  sellingPrice: 0,
  listingMode: "Private Collection / Offer Only",
  minimumAcceptableOffer: 2500000,
  catalogNumber: "BTX2016"
};
const buttechno = await enrichFinanceCatalogProduct(
  { ...draft, id: "finance-nxp-2026-vnl-0044", sku: buttechnoStock.sku, format: "Vinyl", price: 0, open_to_offers: true, minimum_acceptable_offer: 2500000, raw: {} },
  buttechnoStock,
  { catalogArtists: [{ artist: "L.O.T.I.O.N" }, { artist: "The Prodigy" }, { artist: "Suicide" }, { artist: "The Soft Moon" }] }
);
assert.equal(buttechno.publish_status, "Published");
assert.equal(buttechno.visibility, "Public");
assert.equal(buttechno.open_to_offers, true);
assert.equal(buttechno.minimum_acceptable_offer, 2500000);
assert.equal(buttechno.raw.enrichmentStatus, "complete");
assert.equal(buttechno.raw.reviewSource, "Boomkat (quoted)");
assert.deepEqual(buttechno.raw.relatedArtists, ["L.O.T.I.O.N", "The Prodigy", "Suicide", "The Soft Moon"]);
assert.equal(isRecordPublicationReady({ ...buttechno, ...buttechno.raw }), true);

const unsafeStore = applyCatalogPublicationSafety({
  products: [{ ...tim.raw, id: tim.id, financeStockId: "stock-1", publishStatus: "Published", visibility: "Public", reviewQuote: "", reviewSource: "", reviewUrl: "" }]
});
assert.equal(unsafeStore.products[0].publishStatus, "Draft");
assert.equal(unsafeStore.products[0].visibility, "Private");
assert.ok(unsafeStore.products[0].raw.publicationIssues.includes("source-backed review"));

const publicationReadyWithoutEditionOrBarcode = applyCatalogPublicationSafety({
  products: [{
    ...tim.raw,
    id: tim.id,
    financeStockId: "stock-1",
    publishStatus: "Published",
    visibility: "Public",
    edition: "",
    barcode: ""
  }]
});
assert.equal(publicationReadyWithoutEditionOrBarcode.products[0].publishStatus, "Published");

const researchedPartial = {
  id: "finance-partial-research",
  category: "Records",
  format: "Vinyl",
  title: "Partial Research Test",
  artist: "Bauhaus",
  condition: "Used Good",
  price: 250000,
  image: "/public/covers/partial-research.jpg",
  reviewQuote: "",
  reviewSource: "",
  relatedArtists: [],
  publishStatus: "Published",
  visibility: "Public",
  raw: {
    category: "Records",
    format: "Vinyl",
    title: "Partial Research Test",
    artist: "Bauhaus",
    condition: "Used Good",
    price: 250000,
    image: "/public/covers/partial-research.jpg",
    reviewQuote: "",
    reviewSource: "",
    relatedArtists: [],
    publishAfterResearch: true,
    publishStatus: "Published",
    visibility: "Public"
  }
};
assert.equal(isResearchPublicationReady(researchedPartial), true);
assert.ok(recordPublicationIssues(researchedPartial).includes("source-backed review"));
assert.equal(applyCatalogPublicationSafety({ products: [researchedPartial] }).products[0].publishStatus, "Published");

const bauhausEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0041"];
assert.equal(bauhausEditorial.reviewSource, "AllMusic (quoted)");
assert.match(bauhausEditorial.reviewUrl, /^https:\/\/www\.allmusic\.com\/album\//);
assert.ok(bauhausEditorial.reviewQuote.includes("She's in Parties"));
assert.ok(bauhausEditorial.relatedArtists.includes("The Soft Moon"));
const bauhausDiscovered = applyCuratedEditorialOverride(
  { reviewQuote: "", reviewSource: "", relatedArtists: ["Suicide"], cover: "/public/cover.jpg" },
  "nxp-2026-vnl-0041"
);
assert.equal(bauhausDiscovered.reviewSource, "AllMusic (quoted)");
assert.deepEqual(bauhausDiscovered.relatedArtists, ["Suicide", "The Soft Moon", "Nine Inch Nails", "David Bowie"]);
assert.equal(bauhausDiscovered.cover, "/public/cover.jpg");

process.stdout.write("Finance catalog enrichment contract passed.\n");

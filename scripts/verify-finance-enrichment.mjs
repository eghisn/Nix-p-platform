import assert from "node:assert/strict";
import {
  CURATED_EDITORIAL_OVERRIDES,
  RELATED_ARTIST_RESEARCH_VERSION,
  assessMusicBrainzReleaseCandidates,
  applyCuratedEditorialOverride,
  enrichFinanceCatalogProduct,
  inventoryFingerprint,
  isEditorialDescriptionQuality
} from "../api/_lib/catalogEnrichment.js";
import {
  applyCatalogPublicationSafety,
  isResearchPublicationReady,
  isRecordPublicationReady,
  recordPublicationIssues
} from "../src/data/catalogPublication.js";
import { isRecentReleaseProduct, recentReleaseSortComparator } from "../src/data/homeCollections.js";
import { needsFinanceEnrichment } from "../api/_lib/financeState.js";

const stock = {
  sku: "NXP-2026-CD-0025",
  item: "CD",
  itemCondition: "New-Sealed",
  artist: "Gorguts",
  title: "Pleiades' Dust",
  sellingPrice: 273000
};

assert.equal(isRecentReleaseProduct({ category: "Records", format: "CD", year: 2026 }), true);
const recentOrder = [
  { sku: "NXP-2026-CD-0001", artist: "Older 2026", year: 2026, updatedAt: "2026-08-01" },
  { sku: "NXP-2026-CD-0002", artist: "Newer 2026", year: 2026, updatedAt: "2026-08-14" },
  { sku: "NXP-2026-CD-0003", artist: "2025", year: 2025, updatedAt: "2026-08-14" }
].sort(recentReleaseSortComparator);
assert.deepEqual(recentOrder.map((item) => item.artist), ["Newer 2026", "Older 2026", "2025"]);

const draft = {
  id: "finance-nxp-2026-cd-0025",
  sku: stock.sku,
  category: "Records",
  format: stock.item,
  condition: stock.itemCondition,
  price: stock.sellingPrice,
  raw: {}
};

function assertPublishedOrWaitsForSource(product) {
  if (product.raw.relatedArtistsResearch?.status === "source-unavailable") {
    assert.equal(product.publish_status, "Draft");
    assert.equal(product.visibility, "Private");
    return false;
  }
  assert.equal(product.publish_status, "Published");
  assert.equal(product.visibility, "Public");
  return true;
}

const enriched = await enrichFinanceCatalogProduct(draft, stock, {
  catalogArtists: [{ artist: "Meshuggah", label: "Season of Mist" }]
});

assertPublishedOrWaitsForSource(enriched);
assert.match(enriched.image, /^\/public\//);
assert.ok(enriched.description.length > 40);
assert.ok(enriched.raw.reviewQuote);
assert.ok(["complete", "complete-no-related-artists", "needs-related-artist-research"].includes(enriched.raw.enrichmentStatus));
assert.ok(["verified", "combined", "lastfm", "no-verified-match", "curated-exact-release", "source-unavailable"].includes(enriched.raw.relatedArtistsResearch.status));
assert.equal(enriched.raw.relatedArtistResearchVersion, RELATED_ARTIST_RESEARCH_VERSION);
assert.equal(enriched.raw.relatedArtistsResearch.engineVersion, RELATED_ARTIST_RESEARCH_VERSION);
assert.equal(needsFinanceEnrichment(enriched, stock), false);
assert.equal(needsFinanceEnrichment({
  ...enriched,
  description: "Example Artist's 2026 release Example is a Vinyl edition issued by Example Label.",
  descriptionSource: "MusicBrainz",
  raw: { ...enriched.raw, enrichmentStatus: "complete" }
}, stock), true);
assert.equal(needsFinanceEnrichment({
  ...enriched,
  raw: { ...enriched.raw, relatedArtistResearchVersion: "legacy-related-artists-engine" }
}, stock), true);
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
assertPublishedOrWaitsForSource(privateEnriched);
assert.ok(privateEnriched.raw.enrichmentAttemptedAt);

const missingIdentity = await enrichFinanceCatalogProduct(draft, { ...stock, title: "", sellingPrice: 0 });
assert.equal(missingIdentity.publish_status, "Draft");
assert.equal(missingIdentity.visibility, "Private");
assert.equal(missingIdentity.raw.enrichmentStatus, "needs-finance-data");

const tracerVinyl = {
  sku: "NXP-2026-VNL-0061",
  item: "Vinyl",
  artist: "Teengirl Fantasy",
  title: "Tracer",
  sellingPrice: 320000
};
const tracerCdOnly = [{
  title: "Tracer",
  score: 100,
  "artist-credit": [{ name: "Teengirl Fantasy" }],
  media: [{ format: "CD" }],
  "label-info": [{ "catalog-number": "RS1208CD" }]
}];
const tracerAssessment = assessMusicBrainzReleaseCandidates(tracerCdOnly, {
  stock: tracerVinyl,
  expectedTitle: "tracer",
  format: "vinyl"
});
assert.equal(tracerAssessment.release, null);
assert.equal(tracerAssessment.exactAlbumWithDifferentFormat, true);

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
const timPublished = assertPublishedOrWaitsForSource(tim);
assert.ok(["complete", "complete-no-related-artists", "needs-related-artist-research"].includes(tim.raw.enrichmentStatus));
assert.equal(tim.raw.reviewSource, "Pitchfork (quoted)");
assert.ok(["verified", "combined", "lastfm", "no-verified-match", "curated-exact-release", "source-unavailable"].includes(tim.raw.relatedArtistsResearch.status));
assert.equal(tim.images.length, 1, "Used records must not receive an invented product mockup.");
assert.equal(tim.raw.shipping.shippingClass, "small-media-cd-bubble");
if (timPublished) assert.equal(isRecordPublicationReady({ ...tim, ...tim.raw }), true);

const timPlaceholder = await enrichFinanceCatalogProduct(
  { ...draft, id: "finance-nxp-2026-cd-0045", sku: timStock.sku, title: "Legacy Konoyo", raw: {} },
  { ...timStock, title: "Untitled inventory item" },
  { catalogArtists: [{ artist: "Oneohtrix Point Never", label: "Warp Records" }] }
);
assert.equal(timPlaceholder.title, "Konoyo", "Finance placeholders must not block the curated release title.");

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
const buttechnoPublished = assertPublishedOrWaitsForSource(buttechno);
assert.equal(buttechno.open_to_offers, true);
assert.equal(buttechno.minimum_acceptable_offer, 2500000);
assert.ok(["complete", "complete-no-related-artists", "needs-related-artist-research"].includes(buttechno.raw.enrichmentStatus));
assert.equal(buttechno.raw.reviewSource, "Boomkat (quoted)");
assert.ok(["verified", "combined", "lastfm", "no-verified-match", "curated-exact-release", "source-unavailable"].includes(buttechno.raw.relatedArtistsResearch.status));
if (buttechnoPublished) assert.equal(isRecordPublicationReady({ ...buttechno, ...buttechno.raw }), true);

const unsafeStore = applyCatalogPublicationSafety({
  products: [{ ...tim.raw, id: tim.id, financeStockId: "stock-1", publishStatus: "Published", visibility: "Public", reviewQuote: "", reviewSource: "", reviewUrl: "" }]
});
assert.equal(unsafeStore.products[0].publishStatus, "Draft");
assert.equal(unsafeStore.products[0].visibility, "Private");
assert.ok(unsafeStore.products[0].raw.publicationIssues.includes("source-backed review"));

if (timPublished) {
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
}

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
assert.equal(isResearchPublicationReady(researchedPartial), false);
assert.ok(recordPublicationIssues(researchedPartial).includes("source-backed review"));
assert.equal(applyCatalogPublicationSafety({ products: [researchedPartial] }).products[0].publishStatus, "Draft");

const bauhausEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0041"];
assert.equal(isEditorialDescriptionQuality("Artist's 2026 release Title is a Vinyl edition issued by Label, documented by MusicBrainz as rock.", "MusicBrainz"), false);
assert.equal(isEditorialDescriptionQuality(bauhausEditorial.description, bauhausEditorial.descriptionSource), true);
assert.equal(bauhausEditorial.reviewSource, "AllMusic (quoted)");
assert.match(bauhausEditorial.reviewUrl, /^https:\/\/www\.allmusic\.com\/album\//);
assert.ok(bauhausEditorial.reviewQuote.includes("She's in Parties"));
const bauhausDiscovered = applyCuratedEditorialOverride(
  { reviewQuote: "", reviewSource: "", relatedArtists: ["Suicide"], cover: "/public/cover.jpg" },
  "nxp-2026-vnl-0041"
);
assert.equal(bauhausDiscovered.reviewSource, "AllMusic (quoted)");
assert.deepEqual(bauhausDiscovered.relatedArtists, ["Suicide"]);
assert.equal(bauhausDiscovered.cover, "/public/cover.jpg");

for (const sku of [
  "NXP-2026-VNL-0027",
  "NXP-2026-VNL-0038",
  "NXP-2026-VNL-0039",
  "NXP-2026-VNL-0040",
  "NXP-2026-VNL-0041",
  "NXP-2026-VNL-0058"
]) {
  const editorial = CURATED_EDITORIAL_OVERRIDES[sku];
  assert.ok(editorial?.description, `${sku} must have curated editorial copy`);
  assert.equal(isEditorialDescriptionQuality(editorial.description, editorial.descriptionSource), true);
}

process.stdout.write("Finance catalog enrichment contract passed.\n");

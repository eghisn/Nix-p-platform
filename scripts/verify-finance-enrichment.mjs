import assert from "node:assert/strict";
import {
  ARCHIVED_CATALOG_IMAGES,
  CURATED_EDITORIAL_OVERRIDES,
  CURATED_FINANCE_ENRICHMENTS,
  CURATED_RELATED_ARTIST_OVERRIDES,
  RELATED_ARTIST_RESEARCH_VERSION,
  assessMusicBrainzReleaseCandidates,
  assessDiscogsReleaseCandidates,
  applyCuratedEditorialOverride,
  composeDiscogsEditorial,
  discogsReleaseDetailUrl,
  enrichFinanceCatalogProduct,
  inventoryFingerprint,
  isExactDiscogsSearchEvidence,
  isEditorialDescriptionQuality,
  removeDuplicateEditorialCopy,
  mergeExactDiscogsEvidence,
  normalizeDiscogsSearchRelease,
  selectTrustedRecordLabel
} from "../api/_lib/catalogEnrichment.js";
import {
  applyCatalogPublicationSafety,
  hasDuplicateEditorialCopy,
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
  description: "Example Artist's exact pressing is documented by Discogs with a track list and label.",
  descriptionSource: "Discogs release data",
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
const catalogExactAcrossMusicBrainzMedia = assessMusicBrainzReleaseCandidates([{
  id: "2f6a2c3c-acfa-47f9-a44c-36da42d52dca",
  title: "Deep End b/w Momentary Lapse",
  score: 100,
  "artist-credit": [{ name: "Creative Adult" }],
  media: [{ format: "Digital Media" }],
  "label-info": [{ "catalog-number": "RFC097" }]
}], {
  stock: { artist: "Creative Adult", title: "Deep End", item: "Vinyl", catalogNumber: "RFC097" },
  expectedTitle: "deep end",
  format: "vinyl",
  catalogNumber: "rfc097"
});
assert.equal(catalogExactAcrossMusicBrainzMedia.release.id, "2f6a2c3c-acfa-47f9-a44c-36da42d52dca");
assert.equal(catalogExactAcrossMusicBrainzMedia.catalogFormatFallback, true, "An exact catalog number may bridge a source's digital-only medium record without changing Finance's physical format.");

const negativeLoversDiscogs = [{
  id: 9967524,
  type: "release",
  title: "Negative Lovers - Faster Lover",
  format: ["Vinyl", "12\"", "EP"],
  barcode: ["789577728615"],
  catno: "none",
  resource_url: "https://api.discogs.com/releases/9967524"
}];
const negativeLoversAssessment = assessDiscogsReleaseCandidates(negativeLoversDiscogs, {
  stock: { artist: "Negative Lovers", title: "Faster Lover", item: "Vinyl" },
  format: "Vinyl"
});
assert.equal(negativeLoversAssessment.release.id, 9967524);
assert.equal(negativeLoversAssessment.needsPressingIdentifier, false);
const shortenedTitleWithExactCatalog = assessDiscogsReleaseCandidates([
  {
    id: 5986176,
    type: "release",
    title: "Creative Adult - Deep End b/w Momentary Lapse",
    format: ["Vinyl", "7\"", "45 RPM"],
    catno: "RFC097",
    resource_url: "https://api.discogs.com/releases/5986176"
  }
], {
  stock: { artist: "Creative Adult", title: "Deep End", item: "Vinyl", catalogNumber: "RFC097" },
  format: "Vinyl",
  catalogNumber: "rfc097"
});
assert.equal(shortenedTitleWithExactCatalog.release.id, 5986176, "An exact Finance catalog number must match a source title that includes a B-side.");
assert.equal(
  discogsReleaseDetailUrl({ id: 5986176 }),
  "https://api.discogs.com/releases/5986176",
  "An exact Discogs search result without resource_url must still fetch its immutable release detail."
);
assert.equal(
  discogsReleaseDetailUrl({ id: 5986176, resource_url: "https://api.discogs.com/releases/5986176" }),
  "https://api.discogs.com/releases/5986176"
);
assert.equal(
  isExactDiscogsSearchEvidence({ id: 5986176, cover_image: "https://example.test/deep-end.jpg" }, 100),
  true,
  "An exact pressing with search artwork must not depend on the optional Discogs detail response."
);
assert.equal(isExactDiscogsSearchEvidence({ id: 5986176, cover_image: "https://example.test/deep-end.jpg" }, 80), false);
const discogsSearchFallback = normalizeDiscogsSearchRelease({
  ...shortenedTitleWithExactCatalog.release,
  label: ["Run For Cover Records"],
  cover_image: "https://example.test/deep-end.jpg",
  uri: "/release/5986176-Creative-Adult-Deep-End-bw-Momentary-Lapse",
  year: "2014"
}, { artist: "Creative Adult", title: "Deep End", item: "Vinyl" }, 100);
assert.equal(discogsSearchFallback.label, "Run For Cover Records");
assert.equal(discogsSearchFallback.catalogNumber, "RFC097");
assert.equal(discogsSearchFallback.cover, "https://example.test/deep-end.jpg");
assert.equal(discogsSearchFallback.matchConfidence, 100);
assert.match(discogsSearchFallback.sourceUrl, /5986176/);
assert.equal(
  selectTrustedRecordLabel([
    { name: "Ipecac Recordings", catno: "IPC-123" },
    { name: "MPO", catno: "MPO-456" },
    { name: "Tower Vinyl Presents", catno: "TVP-789" }
  ], "IPC-123"),
  "Ipecac Recordings",
  "A label field must contain the matched release label, never a pressing plant or retailer."
);
assert.equal(
  selectTrustedRecordLabel([
    { name: "Distributor Archive", catno: "DIST-1" },
    { name: "Verified Label", catno: "NXP-42" }
  ], "NXP-42"),
  "Verified Label",
  "The catalog-number match must win when Discogs provides several companies."
);
const discogsMergedEvidence = mergeExactDiscogsEvidence({
  title: "Deep End b/w Momentary Lapse",
  artist: "Creative Adult",
  description: "Detail metadata from the exact physical release.",
  descriptionSource: "Discogs release data",
  sourceUrl: "https://www.discogs.com/release/5986176"
}, discogsSearchFallback);
assert.equal(discogsMergedEvidence.cover, "https://example.test/deep-end.jpg", "An exact search cover must survive a detail response without images.");
assert.equal(discogsMergedEvidence.label, "Run For Cover Records");
assert.equal(discogsMergedEvidence.catalogNumber, "RFC097");
const discogsOnlyEditorial = composeDiscogsEditorial({
  description: "Exact physical-release metadata.",
  descriptionSource: "Discogs release data",
  reviewQuote: "Old generic review that must not survive.",
  reviewSource: "Discogs release data",
  reviewUrl: "https://www.discogs.com/release/5986176",
  researchSources: [{ source: "Discogs", url: "https://www.discogs.com/release/5986176", confidence: 95 }]
});
assert.equal(discogsOnlyEditorial.reviewQuote, "", "Discogs object data must never be rendered as a review.");
assert.equal(isEditorialDescriptionQuality(discogsOnlyEditorial.description, discogsOnlyEditorial.descriptionSource), false, "Discogs metadata must not be accepted as public editorial copy.");
const discogsWithOfficialEditorial = composeDiscogsEditorial(discogsOnlyEditorial, {
  bandcamp: {
    description: "Creative Adult's release note describes the record's sound and origin in source-backed editorial detail.",
    descriptionSource: "Official Bandcamp release page",
    reviewQuote: "A direct official release note.",
    reviewSource: "Bandcamp release note (quoted)",
    reviewUrl: "https://creativeadult.bandcamp.com/album/deep-end",
    researchSources: [{ source: "Bandcamp", url: "https://creativeadult.bandcamp.com/album/deep-end", confidence: 80 }]
  }
});
assert.equal(discogsWithOfficialEditorial.descriptionSource, "Official Bandcamp release page");
assert.equal(discogsWithOfficialEditorial.reviewQuote, "", "Editorial copy is not silently promoted to a review without an explicit source selection.");
const discogsWithVerifiedReview = composeDiscogsEditorial(discogsOnlyEditorial, {
  review: {
    quote: "A concise source-backed description from an independently verified review.",
    source: "Stereogum (quoted)",
    url: "https://stereogum.com/example"
  }
});
assert.equal(discogsWithVerifiedReview.descriptionSource, "Discogs release data", "A review must never be reused as product-description copy.");
assert.equal(discogsWithVerifiedReview.description, "Exact physical-release metadata.");
assert.equal(discogsWithVerifiedReview.reviewQuote, "A concise source-backed description from an independently verified review.");
assert.equal(discogsWithVerifiedReview.researchSources.every((source) => !Array.isArray(source)), true, "Research evidence must remain a flat list of source objects.");
const duplicateEditorial = removeDuplicateEditorialCopy({
  description: "A source-backed sentence that must appear once in the product page only.",
  descriptionSource: "Example source",
  reviewQuote: "A source-backed sentence that must appear once in the product page only.",
  reviewSource: "Example review",
  reviewUrl: "https://example.test/review"
});
assert.equal(duplicateEditorial.reviewQuote, "", "Exact duplicate editorial text must not produce a second public quote block.");
assert.equal(duplicateEditorial.reviewSource, "");
assert.equal(duplicateEditorial.reviewUrl, "");
assert.equal(hasDuplicateEditorialCopy(duplicateEditorial.description, duplicateEditorial.description), true);
const legacyDuplicateCandidate = {
  id: "finance-nxp-2026-vnl-legacy-duplicate",
  category: "Records",
  format: "Vinyl",
  title: "Legacy Duplicate",
  artist: "Example Artist",
  condition: "New-Sealed",
  label: "Example Label",
  price: 250000,
  image: "https://example.supabase.co/storage/v1/object/public/product-images/catalog/legacy/cover.jpg",
  description: duplicateEditorial.description,
  raw: {
    enrichmentStatus: "complete",
    reviewQuote: duplicateEditorial.description,
    reviewSource: "Example review"
  }
};
assert.equal(isResearchPublicationReady(legacyDuplicateCandidate), false, "A legacy duplicate must never be accepted as a completed research result.");
const ambiguousDiscogsAssessment = assessDiscogsReleaseCandidates([
  ...negativeLoversDiscogs,
  { ...negativeLoversDiscogs[0], id: 9967525, resource_url: "https://api.discogs.com/releases/9967525" }
], {
  stock: { artist: "Negative Lovers", title: "Faster Lover", item: "Vinyl" },
  format: "Vinyl"
});
assert.equal(ambiguousDiscogsAssessment.needsPressingIdentifier, true);

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
assert.equal(unsafeStore.products[0].publishStatus, "Published");
assert.equal(unsafeStore.products[0].visibility, "Public");
assert.equal(unsafeStore.products[0].raw?.publicationIssues, undefined);

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
  label: "Example Label",
  description: "A verified physical release with a complete description.",
  year: 2026,
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
    label: "Example Label",
    description: "A verified physical release with a complete description.",
    year: 2026,
    image: "/public/covers/partial-research.jpg",
    reviewQuote: "",
    reviewSource: "",
    relatedArtists: [],
    enrichmentStatus: "complete-no-related-artists",
    publishAfterResearch: true,
    publishStatus: "Published",
    visibility: "Public"
  }
};
assert.equal(isResearchPublicationReady(researchedPartial), true);
assert.equal(recordPublicationIssues(researchedPartial).includes("source-backed review"), false);
assert.equal(applyCatalogPublicationSafety({ products: [researchedPartial] }).products[0].publishStatus, "Published");

const bauhausEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0041"];
assert.equal(isEditorialDescriptionQuality("Artist's 2026 release Title is a Vinyl edition issued by Label, documented by MusicBrainz as rock.", "MusicBrainz"), false);
assert.equal(isEditorialDescriptionQuality(bauhausEditorial.description, bauhausEditorial.descriptionSource), true);
for (const sku of ["NXP-2026-VNL-0065", "NXP-2026-VNL-0061"]) {
  const editorial = CURATED_EDITORIAL_OVERRIDES[sku];
  assert.ok(editorial?.reviewUrl, `${sku} must retain a source URL for its curated review.`);
  assert.equal(isEditorialDescriptionQuality(editorial.description, editorial.descriptionSource), true, `${sku} must have source-backed editorial copy.`);
  assert.notEqual(editorial.description, editorial.reviewQuote, `${sku} must not reuse review copy as its description.`);
  const merged = applyCuratedEditorialOverride({
    cover: "/public/covers/exact-edition.jpg",
    edition: "Vinyl, 12\", Limited Edition",
    barcode: "1234567890123",
    catalogNumber: "EXACT-001"
  }, sku);
  assert.equal(merged.cover, "/public/covers/exact-edition.jpg", `${sku} must retain its matched cover.`);
  assert.equal(merged.edition, "Vinyl, 12\", Limited Edition", `${sku} must retain its matched edition.`);
  assert.equal(merged.barcode, "1234567890123", `${sku} must retain its barcode.`);
  assert.equal(merged.catalogNumber, "EXACT-001", `${sku} must retain its catalog number.`);
}
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

const bimaSaktiEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0066"];
assert.equal(bimaSaktiEditorial.reviewSource, "The Quietus (quoted)");
assert.match(bimaSaktiEditorial.reviewUrl, /^https:\/\/thequietus\.com\/quietus-reviews\//);
const bimaSaktiDiscovered = applyCuratedEditorialOverride(
  {
    cover: "/public/cover.jpg",
    edition: "Vinyl, LP, Album, Limited Edition, Violet",
    barcode: "1234567890123",
    catalogNumber: "iDEAL198"
  },
  "NXP-2026-VNL-0066"
);
assert.equal(bimaSaktiDiscovered.cover, "/public/cover.jpg");
assert.equal(bimaSaktiDiscovered.edition, "Vinyl, LP, Album, Limited Edition, Violet");
assert.equal(bimaSaktiDiscovered.barcode, "1234567890123");
assert.equal(bimaSaktiDiscovered.catalogNumber, "iDEAL198");

const chromeNeonJesusEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0072"];
assert.equal(chromeNeonJesusEditorial.reviewSource, "AllMusic (quoted)");
assert.match(chromeNeonJesusEditorial.reviewUrl, /^https:\/\/www\.allmusic\.com\/album\//);
assert.equal(isEditorialDescriptionQuality(chromeNeonJesusEditorial.description, chromeNeonJesusEditorial.descriptionSource), true);
const chromeNeonJesusDiscovered = applyCuratedEditorialOverride(
  {
    cover: "/public/cover.jpg",
    edition: "Vinyl, LP, Album, Limited Edition",
    barcode: "045778759214",
    catalogNumber: "87592-1"
  },
  "NXP-2026-VNL-0072"
);
assert.equal(chromeNeonJesusDiscovered.cover, "/public/cover.jpg");
assert.equal(chromeNeonJesusDiscovered.edition, "Vinyl, LP, Album, Limited Edition");
assert.equal(chromeNeonJesusDiscovered.barcode, "045778759214");
assert.equal(chromeNeonJesusDiscovered.catalogNumber, "87592-1");

for (const [sku, source] of [
  ["NXP-2026-VNL-0081", "Arca official Bandcamp artwork"],
  ["NXP-2026-VNL-0080", "Melvins official Bandcamp artwork"],
  ["NXP-2026-VNL-0079", "Sam Gendel official Bandcamp artwork"],
  ["NXP-2026-VNL-0078", "Cover Art Archive / Third Worlds / Harvest Records"],
  ["NXP-2026-VNL-0076", "Unknown Mortal Orchestra official Bandcamp artwork"],
  ["NXP-2026-VNL-0075", "Cover Art Archive / Dedicated Records"],
  ["NXP-2026-VNL-0073", "Apple Music / The Null Corporation artwork"],
  ["NXP-2026-VNL-0058", "Hyperdub official release artwork"],
  ["NXP-2026-VNL-0040", "Blondie album sleeve artwork"]
]) {
  const artwork = ARCHIVED_CATALOG_IMAGES[sku];
  assert.match(artwork.cover, /^\/public\/assets\/catalog-archive\//);
  assert.equal(artwork.imageCredits?.[0]?.image, artwork.cover);
  assert.equal(artwork.imageCredits?.[0]?.credit, source);
}

for (const [sku, sourceDomain] of [
  ["NXP-2026-VNL-0080", "thequietus.com"],
  ["NXP-2026-VNL-0079", "boomkat.com"],
  ["NXP-2026-VNL-0077", "pitchfork.com"],
  ["NXP-2026-VNL-0075", "allmusic.com"],
  ["NXP-2026-VNL-0072", "allmusic.com"]
]) {
  const editorial = CURATED_EDITORIAL_OVERRIDES[sku];
  assert.equal(isEditorialDescriptionQuality(editorial.description, editorial.descriptionSource), true);
  assert.ok(editorial.reviewQuote);
  assert.ok(editorial.reviewSource.endsWith("(quoted)"));
  assert.equal(new URL(editorial.reviewUrl).hostname.replace(/^www\./, ""), sourceDomain);
}

const thievesLikeUsEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0070"];
assert.equal(thievesLikeUsEditorial.reviewSource, "AllMusic (quoted)");
assert.match(thievesLikeUsEditorial.reviewUrl, /^https:\/\/www\.allmusic\.com\/song\//);
assert.ok(thievesLikeUsEditorial.description.includes("FAC 103"));
assert.deepEqual(
  CURATED_RELATED_ARTIST_OVERRIDES["NXP-2026-VNL-0070"].artists,
  ["Joy Division", "Electronic", "The Other Two", "Monaco"]
);
const confusionEditorial = CURATED_EDITORIAL_OVERRIDES["NXP-2026-VNL-0071"];
assert.equal(confusionEditorial.reviewSource, "AllMusic (quoted)");
assert.match(confusionEditorial.reviewUrl, /^https:\/\/www\.allmusic\.com\/album\//);
assert.ok(confusionEditorial.description.includes("FAC 93"));
assert.deepEqual(
  CURATED_RELATED_ARTIST_OVERRIDES["NXP-2026-VNL-0071"].artists,
  ["Joy Division", "Electronic", "The Other Two", "Monaco"]
);

for (const sku of [
  "NXP-2026-VNL-0027",
  "NXP-2026-VNL-0038",
  "NXP-2026-VNL-0039",
  "NXP-2026-VNL-0040",
  "NXP-2026-VNL-0041",
  "NXP-2026-VNL-0066",
  "NXP-2026-VNL-0058"
]) {
  const editorial = CURATED_EDITORIAL_OVERRIDES[sku];
  assert.ok(editorial?.description, `${sku} must have curated editorial copy`);
  assert.equal(isEditorialDescriptionQuality(editorial.description, editorial.descriptionSource), true);
}

const negativeLovers = CURATED_FINANCE_ENRICHMENTS["NXP-2026-VNL-0062"];
assert.equal(negativeLovers.title, "Faster Lover");
assert.equal(negativeLovers.artist, "Negative Lovers");
assert.equal(negativeLovers.edition, "12-inch EP");
assert.match(negativeLovers.cover, /a0335934103_0\.jpg$/);
assert.equal(isEditorialDescriptionQuality(negativeLovers.description, negativeLovers.descriptionSource), true);
assert.equal(negativeLovers.reviewSource, "Bandcamp release note (quoted)");

process.stdout.write("Finance catalog enrichment contract passed.\n");

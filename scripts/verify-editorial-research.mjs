import assert from "node:assert/strict";
import { editorialSource, editorialPageMatches, fetchEditorialPage, readHtmlMetadata, isReviewArticle, editorialReviewQuote } from "../api/_lib/catalogEditorialSources.js";
import { researchResultUrls, searchCatalogSources } from "../api/_lib/catalogSourceSearch.js";
import { archiveRemoteProductImage, bandcampArchiveFallback } from "../api/_lib/productImageStorage.js";
import { applyVerifiedReleaseDescription, bandcampAlbumGuess, chooseDescriptionEditorial, discoverBandcampRelease, excludeDatabaseEditorial, enrichDiscoveredReview, inventoryFingerprint, matchBandcampPhysicalRelease, reuseVerifiedReleaseCover, reuseVerifiedReleaseMetadata } from "../api/_lib/catalogEnrichment.js";

for (const url of [
  "https://musicbrainz.org/release/example", "https://www.discogs.com/release/example",
  "https://api.discogs.com/releases/123", "https://pitchfork.com.evil.example/review",
  "https://pitchfork.com@localhost/", "http://pitchfork.com/review", "https://127.0.0.1/",
  "https://pitchfork.com:8443/review"
]) {
  assert.equal(editorialSource(url), null);
  assert.equal(editorialSource(url, { official: true }), null);
}
assert.equal(editorialSource("https://ra.co/reviews/123").name, "Resident Advisor");
assert.equal(editorialSource("https://shop.matadorrecords.com/release/123", { official: true }).name, "Matador Records");
assert.equal(editorialPageMatches("Nilufer Yanya: Do You Like Pain? EP review", { artist: "Nilüfer Yanya", title: "Do You Like Pain?" }), true);
assert.equal(editorialPageMatches("Nilufer Yanya: PAINLESS review", { artist: "Nilufer Yanya", title: "Do You Like Pain?" }), false);
assert.equal(editorialPageMatches("Someone Else: Do You Like Pain?", { artist: "Nilufer Yanya", title: "Do You Like Pain?" }), false);
assert.equal(editorialPageMatches("Artist news", { artist: "", title: "" }), false);
assert.equal(readHtmlMetadata('<meta content="Yanya\'s voice &amp; drums" name="description">', "description"), "Yanya's voice & drums");
const legacy = excludeDatabaseEditorial({ description: "Database-derived copy", descriptionSource: "Label / MusicBrainz", reviewQuote: "Marketplace copy", reviewSource: "Release notes", reviewUrl: "https://www.discogs.com/release/1", barcode: "123" });
assert.equal(legacy.description, "");
assert.equal(legacy.reviewQuote, "");
assert.equal(legacy.barcode, "123");

const requests = [];
assert.equal(await fetchEditorialPage("https://pitchfork.com/review", {
  fetcher: async (url) => { requests.push(url); return new Response(null, { status: 302, headers: { location: "https://discogs.com/release/1" } }); }
}), null);
assert.equal(requests.length, 1, "Never follow a redirect to a database or marketplace.");
const page = await fetchEditorialPage("https://pitchfork.com/review", {
  fetcher: async () => new Response('<title>Artist: Album</title><meta name="description" content="An actual editorial description with enough words.">', { headers: { "content-type": "text/html" } })
});
assert.equal(page.source, "Pitchfork");
assert.equal(page.title, "Artist: Album");
assert.equal(await fetchEditorialPage("https://pitchfork.com/review", { fetcher: async () => { throw new Error("timeout"); } }), null);
assert.equal(await fetchEditorialPage("https://pitchfork.com/review", { fetcher: async () => new Response("challenge", { status: 202, headers: { "content-type": "text/html" } }) }), null);
assert.equal(await fetchEditorialPage("https://pitchfork.com/review", { fetcher: async () => new Response("x".repeat(3_000_001), { headers: { "content-type": "text/html" } }) }), null);

const stock = { artist: "Nilufer Yanya", title: "Do You Like Pain?", item: "Vinyl", barcode: "5 051083 129756", catalogNumber: "BFM005" };
const packageData = { type_name: "Vinyl LP", title: '12" (Red Vinyl)', upc: "5051083129756", label: "ATO" };
const documentFor = (data) => `<meta property="og:title" content="Do You Like Pain EP, by Nilufer Yanya"><script data-tralbum='${JSON.stringify(data).replace(/'/g, "&#39;")}'></script>`;
const release = { artist: "Nilufer Yanya", current: { title: "Do You Like Pain EP" }, album_release_date: "28 Feb 2018 00:00:00 GMT", packages: [packageData] };
assert.equal(matchBandcampPhysicalRelease(documentFor(release), stock).barcode, "5051083129756");
assert.equal(matchBandcampPhysicalRelease(documentFor(release), stock).year, 2018);
assert.equal(matchBandcampPhysicalRelease(documentFor(release), { ...stock, barcode: "0000000000000" }), null);
assert.equal(matchBandcampPhysicalRelease(documentFor(release), { ...stock, item: "CD" }), null);
assert.equal(matchBandcampPhysicalRelease(documentFor({ ...release, artist: "Another Artist" }), stock), null);
assert.equal(matchBandcampPhysicalRelease(documentFor({ ...release, artist: "Nilufer Yanya Tribute" }), stock), null);
assert.equal(matchBandcampPhysicalRelease(documentFor({ ...release, packages: [] }), stock), null);
assert.equal(matchBandcampPhysicalRelease(documentFor({ ...release, packages: [{ ...packageData, catalog_number: "WRONG" }] }), stock), null);
assert.equal(matchBandcampPhysicalRelease(documentFor({ ...release, packages: [packageData, packageData] }), stock), null);
assert.equal(matchBandcampPhysicalRelease(documentFor(release), { ...stock, barcode: "" }), null, "Do not match an unspecified catalog number against a merchant SKU.");
const rsStock = { artist: "RS Tangent", title: "Crinkle", item: "Vinyl", catalogNumber: "TTT111" };
const rsRelease = { artist: "RS Tangent", current: { title: "Crinkle" }, packages: [{ type_name: "Vinyl LP", title: 'Limited edition 12" vinyl', sku: "TTT111", label: "The Trilogy Tapes" }] };
assert.equal(bandcampAlbumGuess(rsStock), "https://rstangent.bandcamp.com/album/crinkle");
assert.equal(matchBandcampPhysicalRelease(documentFor(rsRelease), rsStock).catalogNumber, "TTT111");
assert.equal(matchBandcampPhysicalRelease(documentFor(rsRelease), { ...rsStock, catalogNumber: "WRONG" }), null);
assert.equal(matchBandcampPhysicalRelease(documentFor(rsRelease), { ...rsStock, artist: "Other Artist" }), null);
assert.equal(matchBandcampPhysicalRelease(documentFor(rsRelease), { ...rsStock, item: "CD" }), null);
assert.match(applyVerifiedReleaseDescription({ cover: "/public/test.jpg" }, rsStock).reviewSource, /Boomkat/);
const massiveAttackStock = { artist: "Massive Attack, Tom Waits", title: "Boots On The Ground" };
const massiveAttackEditorial = applyVerifiedReleaseDescription({ cover: "/public/test.jpg", catalogNumber: "PIASR1700PS", barcode: "4526180760559" }, massiveAttackStock);
assert.match(massiveAttackEditorial.description, /The Fly/);
assert.equal(massiveAttackEditorial.reviewResearch.scope, "track");
assert.equal(massiveAttackEditorial.catalogNumber, "PIASR1700PS");
assert.equal(massiveAttackEditorial.barcode, "4526180760559");
assert.equal(applyVerifiedReleaseDescription({ needsPressingIdentifier: true }, massiveAttackStock).description, undefined);
const oversizedBandcampCover = "https://f4.bcbits.com/img/a1899538574_0.jpg";
const sizedBandcampCover = "https://f4.bcbits.com/img/a1899538574_10.jpg";
assert.equal(bandcampArchiveFallback(oversizedBandcampCover), sizedBandcampCover);
assert.equal(bandcampArchiveFallback("https://f4.bcbits.com.evil.example/img/a1899538574_0.jpg"), "");
const priorFetch = globalThis.fetch;
const priorUrl = process.env.SUPABASE_URL;
const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
try {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    if (url === oversizedBandcampCover) return new Response("x", { headers: { "content-type": "image/png", "content-length": "10382340" } });
    if (url === sizedBandcampCover) return new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } });
    if (url === "https://example.supabase.co/storage/v1/object/product-images/catalog/test-sku/cover.jpg") return new Response("{}", { status: 200 });
    throw new Error(`Unexpected archive request: ${url}`);
  };
  const archived = await archiveRemoteProductImage({ url: oversizedBandcampCover, sku: "TEST-SKU" });
  assert.equal(archived.archived, true);
  assert.deepEqual(requested, [oversizedBandcampCover, sizedBandcampCover, "https://example.supabase.co/storage/v1/object/product-images/catalog/test-sku/cover.jpg"]);
} finally {
  globalThis.fetch = priorFetch;
  if (priorUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
}

for (const [artist, title, source] of [
  ["Fucked Up", "Year Of The Ox", "Merge Records"],
  ["Savages", "Fuckers / Dream Baby Dream", "Pitchfork"],
  ["Nilufer Yanya", "Do You Like Pain?", "ATO Records"]
]) {
  const metadata = { cover: "/public/test.jpg", edition: "Exact edition", barcode: "12345", catalogNumber: "CAT-1", description: "" };
  const result = applyVerifiedReleaseDescription(metadata, { artist, title });
  assert.equal(result.descriptionSource, source);
  assert.ok(result.description.split(/\s+/).length >= 45);
  for (const key of ["cover", "edition", "barcode", "catalogNumber"]) assert.equal(result[key], metadata[key]);
  assert.ok(result.researchSources.some((entry) => editorialSource(entry.url) || editorialSource(entry.url, { official: true })));
  assert.equal(chooseDescriptionEditorial({ description: "A manually written description." }, {}, result).description, "A manually written description.");
  assert.equal(applyVerifiedReleaseDescription({ needsPressingIdentifier: true }, { artist, title }).description, undefined);
}
assert.equal(applyVerifiedReleaseDescription({ description: "", year: 2026 }, { artist: "Unknown", title: "Unknown" }).description, "", "No generic metadata fallback.");
const existing = { description: "Previously verified editorial copy.", raw: { descriptionSource: "Pitchfork" } };
assert.equal(chooseDescriptionEditorial(existing, { description: existing.description }, { description: "" }).description, existing.description, "A missing new result must not erase good automatic copy.");
const archivedRow = { raw: { autoCover: "/public/verified-cover.jpg", musicBrainzReleaseId: "exact-release", enrichmentFingerprint: inventoryFingerprint(stock) } };
assert.equal(reuseVerifiedReleaseCover({ musicBrainzReleaseId: "exact-release", cover: "" }, archivedRow, stock).cover, "/public/verified-cover.jpg");
assert.equal(reuseVerifiedReleaseCover({ musicBrainzReleaseId: "other-edition", cover: "" }, archivedRow, stock).cover, "");
assert.equal(reuseVerifiedReleaseCover({ musicBrainzReleaseId: "exact-release", cover: "" }, archivedRow, { ...stock, barcode: "different" }).cover, "");
assert.equal(reuseVerifiedReleaseCover({ sourceUnavailable: true }, archivedRow, stock).cover, undefined);
console.log("Editorial source, redirect, identity, physical-edition, reviewed-copy and preservation checks passed.");

const reviewed = applyVerifiedReleaseDescription({ cover: "/public/cover.jpg" }, { artist: "Nilufer Yanya", title: "Do You Like Pain?" });
assert.equal(reviewed.reviewResearch.scope, "track");
assert.match(reviewed.reviewSource, /Baby Luv/);
assert.equal((await enrichDiscoveredReview(reviewed, stock, { searcher: async () => { throw new Error("Must not rediscover a reviewed source"); } })).reviewQuote, reviewed.reviewQuote);
assert.equal(isReviewArticle("https://pitchfork.com/news/album-announcement/"), false);
assert.equal(isReviewArticle("https://pitchfork.com/reviews/tracks/test/"), true);
assert.equal(editorialReviewQuote("4 tracks, released 2018"), "");
assert.ok(editorialReviewQuote("word ".repeat(40)).endsWith("..."));

const fallbackCalls = [];
const found = await searchCatalogSources({ artist: "Test Artist", title: "Exact Album", kind: "bandcamp", fetcher: async (url) => {
  fallbackCalls.push(url);
  if (fallbackCalls.length === 1) return new Response("challenge", { status: 202 });
  if (fallbackCalls.length === 2) throw new Error("timeout");
  return new Response('<a href="https://testartist.bandcamp.com/album/exact-album?from=search">album</a>');
} });
assert.equal(fallbackCalls.length, 3);
assert.deepEqual(found.urls, ["https://testartist.bandcamp.com/album/exact-album"]);
assert.equal(found.unavailable, false);
assert.deepEqual(researchResultUrls('<a href="https://discogs.com/release/1">x</a><a href="https://pitchfork.com.evil.test/reviews/x">y</a>', "https://search.brave.com", "review"), []);
const unavailable = await searchCatalogSources({ artist: "Test", title: "Album", fetcher: async () => new Response("", { status: 429 }) });
assert.equal(unavailable.unavailable, true);
const partiallyAvailable = await searchCatalogSources({ artist: "Test", title: "Album", fetcher: async (url) =>
  url.includes("duckduckgo") ? new Response("", { status: 429 }) : new Response("<html><body>No matching review</body></html>")
});
assert.equal(partiallyAvailable.unavailable, false, "A blocked search endpoint must not disguise successful no-result searches as an outage.");
assert.equal(partiallyAvailable.attempts.filter((attempt) => attempt.status === "no-results").length, 1);
let activeSearches = 0;
let peakSearches = 0;
await searchCatalogSources({ artist: "Test", title: "Album", kind: "bandcamp", fetcher: async () => {
  activeSearches += 1;
  peakSearches = Math.max(peakSearches, activeSearches);
  await new Promise((resolve) => setTimeout(resolve, 0));
  activeSearches -= 1;
  return new Response("<html></html>");
} });
assert.equal(peakSearches, 3, "Independent search endpoints should share one bounded wait window.");
const priorBandcampFetch = globalThis.fetch;
try {
  let activeCandidates = 0;
  let peakCandidates = 0;
  const exactPage = `<meta property="og:image" content="https://f4.bcbits.com/img/a1234567890_10.jpg">${documentFor({
    artist: "Test Artist", current: { title: "Exact Album" }, packages: [{ type_name: "Vinyl LP", title: "12-inch vinyl", upc: "1234567890123", catalog_number: "CAT1" }]
  })}`;
  globalThis.fetch = async (url) => {
    activeCandidates += 1;
    peakCandidates = Math.max(peakCandidates, activeCandidates);
    await new Promise((resolve) => setTimeout(resolve, 0));
    activeCandidates -= 1;
    return new Response(url.includes("correct.bandcamp.com") ? exactPage : "<html></html>");
  };
  const candidate = await discoverBandcampRelease({
    artist: "Test Artist", title: "Exact Album", item: "Vinyl", barcode: "1234567890123", catalogNumber: "CAT1",
    researchUrls: ["https://wrong.bandcamp.com/album/exact-album", "https://correct.bandcamp.com/album/exact-album"]
  });
  assert.equal(peakCandidates, 3, "Candidate release pages should be checked in one bounded batch.");
  assert.equal(candidate.sourceUrl, "https://correct.bandcamp.com/album/exact-album");
  assert.equal(candidate.barcode, "1234567890123");
} finally {
  globalThis.fetch = priorBandcampFetch;
}
const challenge = await searchCatalogSources({ artist: "Test", title: "Album", kind: "bandcamp", fetcher: async () => new Response("<title>Client Challenge</title>") });
assert.equal(challenge.urls.length, 0);
assert.equal(challenge.unavailable, true);
assert.equal(challenge.attempts[0].status, "unavailable");

for (const sourceType of ["bandcamp", "musicbrainz", "verified-release-cache"]) {
  let searches = 0;
  const result = await enrichDiscoveredReview({ sourceType, description: "Existing original description." }, { artist: "Test Artist", title: "Exact Album" }, {
    searcher: async () => { searches += 1; return { urls: ["https://pitchfork.com/reviews/albums/test/"], attempts: [], unavailable: false }; },
    pageFetcher: async (url) => ({ url, title: "Test Artist: Exact Album Review", source: "Pitchfork", description: "A restless record that makes space for quiet detail." })
  });
  assert.equal(searches, 1, `${sourceType} must not bypass review research.`);
  assert.equal(result.reviewResearch.status, "verified");
  assert.equal(result.description, "Existing original description.");
}
const newsResult = await enrichDiscoveredReview({}, { artist: "Test Artist", title: "Exact Album" }, {
  searcher: async () => ({ urls: ["https://pitchfork.com/news/announcement/"], attempts: [], unavailable: false }),
  pageFetcher: async (url) => ({ url, title: "Test Artist: Exact Album", source: "Pitchfork", description: "A new record will be released next month." })
});
assert.equal(newsResult.reviewQuote, "", "News must not masquerade as criticism.");

const moonStock = { artist: "Moon Diagrams", title: "Trappy Bats", item: "Vinyl", catalogNumber: "GN54", edition: 'Vinyl, LP, Mini-Album, Limited Edition, Purple / Black Split' };
const moonEvidence = { catalogNumber: "GN54", format: "Vinyl", edition: moonStock.edition, packageTitle: "Limited Edition Black & Purple Vinyl", evidenceUrl: "https://www.geographic-north.com/" };
const moonHtml = documentFor({ artist: "Moon Diagrams", current: { title: "Trappy Bats" }, album_release_date: "02 Aug 2019", packages: [{ type_name: "Vinyl LP", title: moonEvidence.packageTitle, sku: "MD-TB-LEBP", label: "Geographic North" }] });
assert.equal(matchBandcampPhysicalRelease(moonHtml, moonStock), null, "Merchant SKU does not prove GN54.");
assert.equal(matchBandcampPhysicalRelease(moonHtml, moonStock, moonEvidence).catalogNumber, "GN54");
assert.equal(matchBandcampPhysicalRelease(moonHtml, { ...moonStock, edition: "Yellow vinyl" }, moonEvidence), null);
assert.equal(matchBandcampPhysicalRelease(moonHtml, { ...moonStock, catalogNumber: "SCR127" }, moonEvidence), null);
assert.equal(matchBandcampPhysicalRelease(moonHtml, { ...moonStock, item: "CD" }, moonEvidence), null);
const cacheRow = { label: "Geographic North", year: 2019, title: "Trappy Bats", description: "Manual text", raw: { edition: moonStock.edition, catalogNumber: "GN54", enrichmentStatus: "complete", enrichmentFingerprint: inventoryFingerprint(moonStock), autoCover: "/public/cover.jpg", metadataSourceUrl: "https://moondiagrams.bandcamp.com/album/trappy-bats" } };
assert.ok(reuseVerifiedReleaseMetadata(cacheRow, moonStock));
assert.equal(reuseVerifiedReleaseMetadata(cacheRow, moonStock).description, "", "Manual copy must not become the automatic baseline.");
assert.equal(reuseVerifiedReleaseMetadata(cacheRow, { ...moonStock, catalogNumber: "OTHER" }), null);
assert.equal(reuseVerifiedReleaseMetadata(cacheRow, { ...moonStock, edition: "Yellow vinyl" }), null);
console.log("Independent review, scoped quotes, search fallback, exact pressing and verified-cache checks passed.");

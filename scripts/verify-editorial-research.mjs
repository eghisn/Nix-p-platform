import assert from "node:assert/strict";
import { editorialSource, editorialPageMatches, fetchEditorialPage, readHtmlMetadata, isReviewArticle, editorialReviewQuote } from "../api/_lib/catalogEditorialSources.js";
import { researchResultUrls, searchCatalogSources } from "../api/_lib/catalogSourceSearch.js";
import { applyVerifiedReleaseDescription, chooseDescriptionEditorial, excludeDatabaseEditorial, enrichDiscoveredReview, inventoryFingerprint, matchBandcampPhysicalRelease, reuseVerifiedReleaseCover, reuseVerifiedReleaseMetadata } from "../api/_lib/catalogEnrichment.js";

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

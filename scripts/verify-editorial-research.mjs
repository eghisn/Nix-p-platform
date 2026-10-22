import assert from "node:assert/strict";
import { editorialSource, editorialPageMatches, fetchEditorialPage, readHtmlMetadata } from "../api/_lib/catalogEditorialSources.js";
import { applyVerifiedReleaseDescription, chooseDescriptionEditorial, excludeDatabaseEditorial, matchBandcampPhysicalRelease } from "../api/_lib/catalogEnrichment.js";

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
console.log("Editorial source, redirect, identity, physical-edition, reviewed-copy and preservation checks passed.");

import assert from "node:assert/strict";
import { combineRelatedArtistEvidence, isExplicitManualRelatedArtistsOverride, resolveRelatedArtistDisplay } from "../api/_lib/catalogEnrichment.js";

const musicBrainz = [
  { artist: "Artist One", source: "MusicBrainz release relationship" },
  { artist: "Artist Two", source: "MusicBrainz release artist credit" },
  { artist: "Artist Three", source: "MusicBrainz artist relationship" }
];
const lastFm = [
  { artist: "Artist Four", source: "Last.fm similar artist" },
  { artist: "Artist Two", source: "Last.fm similar artist" },
  { artist: "Artist Five", source: "Last.fm similar artist" }
];

const combined = combineRelatedArtistEvidence(musicBrainz, lastFm, 5);
assert.equal(combined.length, 5, "related artists must be capped at five");
assert.equal(new Set(combined.map((item) => item.artist)).size, combined.length, "duplicate artists must be removed");
assert.ok(combined.some((item) => item.sources?.includes("MusicBrainz")), "MusicBrainz evidence must remain");
assert.ok(combined.some((item) => item.sources?.includes("Last.fm")), "Last.fm evidence must remain");
const shared = combined.find((item) => item.artist === "Artist Two");
assert.ok(shared?.sources?.includes("MusicBrainz") && shared?.sources?.includes("Last.fm"), "shared evidence must retain both sources");

const lastFmOnly = combineRelatedArtistEvidence([], [{ artist: "Artist Four", source: "Last.fm similar artist" }], 5);
assert.deepEqual(lastFmOnly.map((item) => item.artist), ["Artist Four"]);

assert.deepEqual(
  resolveRelatedArtistDisplay({ manualRelatedArtists: ["Admin Choice"], automaticRelatedArtists: ["Research Choice"], manualRelatedArtistsOverride: true }),
  { relatedArtists: ["Admin Choice"], manualRelatedArtistsOverride: true },
  "an explicit Admin edit must remain authoritative"
);
assert.deepEqual(
  resolveRelatedArtistDisplay({ manualRelatedArtists: [], automaticRelatedArtists: ["Research Choice"] }),
  { relatedArtists: ["Research Choice"], manualRelatedArtistsOverride: false },
  "without an override, automatic research must remain visible"
);
assert.equal(
  isExplicitManualRelatedArtistsOverride({ manualRelatedArtistsOverride: true, manualRelatedArtists: [], autoEditorial: { relatedArtists: ["Research Choice"] } }, ["Research Choice"]),
  false,
  "legacy empty overrides must not hide valid automatic research"
);
assert.equal(
  isExplicitManualRelatedArtistsOverride({ manualRelatedArtistsOverride: true, manualRelatedArtists: [], manualRelatedArtistsOverrideSource: "admin" }, ["Research Choice"]),
  true,
  "an intentional Admin clear must remain authoritative"
);

console.log(`Related-artist source combination passed: ${combined.length} deduplicated results from MusicBrainz + Last.fm.`);

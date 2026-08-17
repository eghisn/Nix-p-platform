import assert from "node:assert/strict";
import { reconcilePublicRevision } from "../api/_lib/supabase.js";

const baseRemote = {
  id: "p1",
  sku: "NXP-TEST-001",
  title: "Verified Release",
  artist: "Artist",
  category: "Records",
  format: "Vinyl",
  condition: "New-Sealed",
  label: "Label",
  year: 2026,
  price: 300000,
  qty: 1,
  publishStatus: "Published",
  visibility: "Public",
  description: "A source-backed release description with enough detail.",
  reviewQuote: "A source-backed review quote.",
  reviewSource: "Music publication (quoted)",
  image: "/public/new-cover.jpg",
  images: ["/public/new-cover.jpg"],
  enrichmentStatus: "complete",
  relatedArtists: ["Mount Sims"],
  relatedArtistEvidence: [{ artist: "Mount Sims", source: "MusicBrainz" }],
  relatedArtistsResearch: { status: "verified", evidence: [{ artist: "Mount Sims" }] }
};

const staleSnapshot = {
  ...baseRemote,
  title: "Old Snapshot Title",
  description: "Old snapshot description.",
  relatedArtists: ["Blawan"],
  relatedArtistEvidence: [{ artist: "Blawan", source: "legacy" }],
  relatedArtistsResearch: { status: "verified", evidence: [{ artist: "Blawan" }] },
  image: "/public/old-cover.jpg",
  images: ["/public/old-cover.jpg"]
};

const refreshed = reconcilePublicRevision([baseRemote], [staleSnapshot])[0];
assert.deepEqual(refreshed.relatedArtists, ["Mount Sims"]);
assert.equal(refreshed.relatedArtistEvidence[0].source, "MusicBrainz");
assert.deepEqual(refreshed.relatedArtistsResearch, baseRemote.relatedArtistsResearch);

const noMatchRemote = {
  ...baseRemote,
  relatedArtists: [],
  relatedArtistEvidence: [],
  relatedArtistsResearch: { status: "no-verified-match", evidence: [] },
  enrichmentStatus: "complete-no-related-artists"
};
const cleared = reconcilePublicRevision([noMatchRemote], [staleSnapshot])[0];
assert.deepEqual(cleared.relatedArtists, []);
assert.equal(cleared.relatedArtistsResearch.status, "no-verified-match");

const sourceUnavailableRemote = {
  ...noMatchRemote,
  relatedArtistsResearch: { status: "source-unavailable", evidence: [] },
  enrichmentStatus: "needs-related-artist-research"
};
const preserved = reconcilePublicRevision([sourceUnavailableRemote], [staleSnapshot])[0];
assert.deepEqual(preserved.relatedArtists, ["Blawan"]);

console.log("Public reconciliation contract passed.");

import assert from "node:assert/strict";
import { reconcilePublicRevision } from "../api/_lib/supabase.js";
import { reconcilePublicCatalog } from "../src/services/adminStore.js";

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

const manualClearRemote = {
  ...sourceUnavailableRemote,
  manualRelatedArtists: [],
  manualRelatedArtistsOverride: true,
  relatedArtists: []
};
const manuallyCleared = reconcilePublicRevision([manualClearRemote], [staleSnapshot])[0];
assert.deepEqual(manuallyCleared.relatedArtists, [], "an explicit empty Admin override must clear stale snapshot tags");
assert.equal(manuallyCleared.manualRelatedArtistsOverride, true);

const snapshotStore = {
  products: [
    { ...staleSnapshot, id: "p1" },
    { ...baseRemote, id: "p2", title: "Second Release" }
  ],
  artists: [{ id: "artist-1", name: "Artist", status: "Published" }]
};
const partialRemoteStore = {
  products: [{ ...baseRemote, id: "p1" }],
  artists: []
};
const partialReconciled = reconcilePublicCatalog(partialRemoteStore, snapshotStore);
assert.deepEqual(
  partialReconciled.products.map((product) => product.id).sort(),
  ["p1", "p2"],
  "a partial API response must not remove products from the deployed snapshot"
);
const emptyReconciled = reconcilePublicCatalog({ products: [], artists: [] }, snapshotStore);
assert.equal(emptyReconciled.products.length, 2, "an empty API response must not blank the public catalog");

console.log("Public reconciliation contract passed.");

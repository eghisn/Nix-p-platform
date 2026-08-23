import assert from "node:assert/strict";
import { catalogResearchRequest, isResearchableCatalogStock, retryDelaySeconds } from "../api/_lib/catalogResearchJobs.js";
import { normalizeRelatedArtistsPayload } from "../api/_lib/catalogEnrichment.js";

const completeRecord = {
  sku: "NXP-2026-VNL-TEST",
  artist: "Example Artist",
  title: "Example Release",
  item: "Vinyl",
  sellingPrice: 250000,
  catalogNumber: "ABC-01"
};

assert.equal(isResearchableCatalogStock(completeRecord), true, "A record with no barcode must still be researchable.");
assert.equal(isResearchableCatalogStock({ ...completeRecord, title: "" }), false, "Finance identity must include a title.");
assert.equal(isResearchableCatalogStock({ ...completeRecord, sellingPrice: 0 }), false, "A normal sale needs a price.");

const job = catalogResearchRequest(completeRecord, { requestedBy: "test" });
assert.equal(job.sku, "NXP-2026-VNL-TEST");
assert.equal(job.status, "queued");
assert.ok(job.request_fingerprint, "A durable job must have an input fingerprint.");
assert.equal(retryDelaySeconds(1), 30);
assert.equal(retryDelaySeconds(5), 480);
assert.equal(retryDelaySeconds(99), 3600);

const automatic = normalizeRelatedArtistsPayload({
  raw: {},
  research: { artists: ["Artist B", "Artist B", "Artist C"] }
});
assert.deepEqual(automatic.relatedArtists, ["Artist B", "Artist C"], "Research artists must reach the storefront display list.");

const manual = normalizeRelatedArtistsPayload({
  raw: { manualRelatedArtists: ["Artist D"], manualRelatedArtistsOverride: true, manualRelatedArtistsOverrideSource: "admin" },
  research: { artists: ["Artist B"] }
});
assert.deepEqual(manual.relatedArtists, ["Artist D"], "Admin manual related artists must take precedence over research.");

console.log("Catalog research job contract verified.");

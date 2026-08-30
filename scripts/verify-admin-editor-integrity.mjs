import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { comparePublicCatalogRevision } from "../api/_lib/publicCatalogDeployment.js";
import { publicProductFingerprint } from "../api/_lib/publicCatalogRevision.js";

const baseProduct = {
  id: "record-1",
  sku: "NXP-TEST-001",
  title: "Test Release",
  artist: "Test Artist",
  category: "Records",
  format: "Vinyl",
  edition: "Black vinyl",
  barcode: "1234567890123",
  catalogNumber: "TEST-01",
  condition: "New-Unsealed",
  mediaCondition: "Mint",
  sleeveCondition: "Near Mint",
  year: 2026,
  label: "Test Label",
  image: "/public/test.jpg",
  images: ["/public/test.jpg"],
  description: "A precise editorial description.",
  reviewQuote: "A precise review quote.",
  reviewSource: "Test Source",
  relatedArtists: ["Related Artist"],
  publishStatus: "Published",
  visibility: "Public"
};

assert.equal(
  comparePublicCatalogRevision([baseProduct], [baseProduct]).confirmed,
  true,
  "An identical public product must verify."
);
for (const [field, value] of [
  ["barcode", "9999999999999"],
  ["edition", "Gold vinyl"],
  ["sleeveCondition", "Corner crease"],
  ["description", "Different editorial copy."],
  ["relatedArtists", ["Different Artist"]],
  ["images", ["/public/different.jpg"]]
]) {
  const changed = { ...baseProduct, [field]: value };
  assert.notEqual(publicProductFingerprint(changed), publicProductFingerprint(baseProduct));
  assert.equal(
    comparePublicCatalogRevision([baseProduct], [changed], [baseProduct.sku]).confirmed,
    false,
    `${field} must be part of live deployment verification.`
  );
}
assert.equal(
  comparePublicCatalogRevision([{ ...baseProduct, publishStatus: "Draft", visibility: "Private" }], [], [baseProduct.sku]).confirmed,
  true,
  "An unpublished product is confirmed only when absent from public catalog."
);
assert.equal(
  comparePublicCatalogRevision([{ ...baseProduct, publishStatus: "Draft", visibility: "Private" }], [baseProduct], [baseProduct.sku]).confirmed,
  false,
  "A stale public product must block unpublish confirmation."
);

const adminStoreSource = await readFile(new URL("../src/services/adminStore.js", import.meta.url), "utf8");
const saveProductSource = adminStoreSource.slice(
  adminStoreSource.indexOf("async saveProduct(data)"),
  adminStoreSource.indexOf("updateProductStatus", adminStoreSource.indexOf("async saveProduct(data)"))
);
assert.match(saveProductSource, /persistProduct\(product/);
assert.doesNotMatch(saveProductSource, /writeStore\(/, "Save Product must not write the complete Admin store.");

const serverStoreSource = await readFile(new URL("../api/admin/store.js", import.meta.url), "utf8");
assert.match(serverStoreSource, /tables:\s*\["artists", "collections", "requests", "offers"\]/);
assert.match(serverStoreSource, /commerceAction=home-slider|action === "home-slider"/);

const researchSource = await readFile(new URL("../api/_lib/catalogResearchJobs.js", import.meta.url), "utf8");
assert.match(researchSource, /lease_expires_at/);
assert.match(researchSource, /recoverExpiredCatalogResearchJobs/);
assert.match(researchSource, /worker-lease-expired/);
assert.match(researchSource, /publicationJobsForProducts/);
assert.match(researchSource, /request_fingerprint=eq/);

const supabaseSource = await readFile(new URL("../api/_lib/supabase.js", import.meta.url), "utf8");
assert.match(supabaseSource, /saveProductPublicationStatus\(store, productId, \{ expectedRevision/);
assert.match(supabaseSource, /edit_revision=eq\.\$\{currentRevision\}/);

const financeSource = await readFile(new URL("../api/_lib/financeState.js", import.meta.url), "utf8");
assert.match(financeSource, /editorial_updated_by: "related-artists-research"/);
assert.match(financeSource, /A newer product edit arrived while related artists were refreshing/);

const financeQueueSource = await readFile(new URL("../api/_lib/adminFinanceSyncJobs.js", import.meta.url), "utf8");
assert.match(financeQueueSource, /product_revision/);
assert.match(financeQueueSource, /A newer product revision replaced this sync request/);

const productSaveSource = await readFile(new URL("../api/admin/store.js", import.meta.url), "utf8");
assert.match(productSaveSource, /enqueueAdminFinanceSyncJob/);
assert.match(productSaveSource, /financeSync/);

const migration = await readFile(new URL("../supabase/migrations/20260830045706_admin_product_revisions_and_research_leases.sql", import.meta.url), "utf8");
assert.match(migration, /edit_revision bigint/);
assert.match(migration, /save_admin_home_slider/);
assert.match(migration, /sync_finance_catalog_operational/);

const financeQueueMigration = await readFile(new URL("../supabase/migrations/20260830105625_admin_finance_sync_jobs.sql", import.meta.url), "utf8");
assert.match(financeQueueMigration, /admin_finance_sync_jobs/);
assert.match(financeQueueMigration, /unique \(product_id, product_revision\)/);

console.log("Admin editor concurrency, deployment, and lease contracts verified.");

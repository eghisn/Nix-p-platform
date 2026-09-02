import assert from "node:assert/strict";
import { hasCompleteShippingProfile, referenceShippingProfile } from "../src/data/shippingProfiles.js";

const vinyl = referenceShippingProfile({ format: "Vinyl", edition: "LP" });
assert.equal(vinyl.packagingGroup, "VINYL");
assert.equal(vinyl.weightGrams, 550);
assert.equal(hasCompleteShippingProfile(vinyl), true);

const heavyVinyl = referenceShippingProfile({ format: "Vinyl", edition: "180g 2 x LP" });
assert.equal(heavyVinyl.vinylWeightClass, "heavy");
assert.equal(heavyVinyl.weightGrams, 750);

const cassette = referenceShippingProfile({ format: "Cassette" });
assert.equal(cassette.packagingGroup, "SMALL_MEDIA");
assert.equal(cassette.shippingClass, "small-media-cassette-bubble");

const manual = { manualShippingOverride: true, weightGrams: 999 };
assert.equal(referenceShippingProfile({ format: "CD" }, manual), manual);

const tshirt = referenceShippingProfile({ category: "Apparel", apparelType: "T-shirt", title: "New Tee" });
assert.equal(tshirt.packagingGroup, "SOFT_APPAREL");
assert.equal(tshirt.packageType, "zip-lock-polybag-shipping-wrap");
assert.equal(tshirt.weightGrams, 280);

const hoodie = referenceShippingProfile({ category: "Apparel", apparelType: "Hoodie" });
assert.equal(hoodie.packagingGroup, "SOFT_APPAREL");
assert.equal(hoodie.weightGrams, 900);

const cap = referenceShippingProfile({ category: "Apparel", apparelType: "Cap" });
assert.equal(cap.packagingGroup, "CAP_HARDBOX");
assert.deepEqual([cap.lengthCm, cap.widthCm, cap.heightCm], [20, 20, 8]);

const ring = referenceShippingProfile({ category: "Objects", title: "Silver Ring" });
assert.equal(ring.packagingGroup, "RING_HARDBOX");
assert.deepEqual([ring.lengthCm, ring.widthCm, ring.heightCm], [10, 8, 7]);

const preserved = referenceShippingProfile(
  { category: "Apparel", apparelType: "T-shirt" },
  { weightGrams: 333, lengthCm: 37, widthCm: 29, heightCm: 4, status: "needs_measurement" }
);
assert.equal(preserved.weightGrams, 333);
assert.equal(preserved.packagingGroup, "SOFT_APPAREL");

const unknownApparel = referenceShippingProfile({ category: "Apparel", apparelType: "Jacket" });
assert.equal(unknownApparel.status, "needs_measurement");
assert.equal(unknownApparel.packagingGroup, undefined);

process.stdout.write("Shipping profile contract passed.\n");

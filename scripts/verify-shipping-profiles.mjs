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

process.stdout.write("Shipping profile contract passed.\n");

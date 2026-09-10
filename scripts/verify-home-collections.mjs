import assert from "node:assert/strict";
import { isLimitedPressingProduct } from "../src/data/homeCollections.js";

const availableVinyl = {
  category: "Records",
  format: "Vinyl",
  qty: 1
};

assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Vinyl, LP, Limited Edition, Violet" }), true);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Vinyl, 12 inch, EP, Numbered" }), true);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Record Store Day Limited Edition" }), true);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Limited Edition", stock: { available: null } }), true);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Vinyl, LP, Purple Vinyl" }), false);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Vinyl, LP, Limited Edition", stock: { available: 0 } }), false);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, category: "Apparel", edition: "Limited Edition" }), false);
assert.equal(isLimitedPressingProduct({ ...availableVinyl, edition: "Vinyl, LP", description: "A limited run" }), false);

console.log("Automatic Limited Pressing collection checks passed.");

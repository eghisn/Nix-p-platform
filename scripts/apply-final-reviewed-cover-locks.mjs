import { readFile, writeFile } from "node:fs/promises";
import { applyFinalReviewedCoverLock } from "../api/_lib/catalogEnrichment.js";

const path = "public/data/public-store.json";
const store = JSON.parse(await readFile(path, "utf8"));
let updated = 0;
store.products = (store.products || []).map((product) => {
  const locked = applyFinalReviewedCoverLock(product);
  if (locked.image !== product.image || JSON.stringify(locked.images) !== JSON.stringify(product.images)) updated += 1;
  return locked;
});
await writeFile(path, `${JSON.stringify(store, null, 2)}\n`);
console.log(`Applied final reviewed cover locks to ${updated} product(s).`);

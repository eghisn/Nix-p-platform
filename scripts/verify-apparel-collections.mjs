import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { apparelCollection } from "../src/data/apparelCategory.js";
import { apparelPageMarkup } from "../src/components/catalogPage.js";

const store = JSON.parse(await readFile("public/data/public-store.json", "utf8"));
const apparel = store.products.filter((product) => product.category === "Apparel");
for (const sku of ["NXP-2026-APP-0010", "NXP-2026-APP-0002", "NXP-2023-APP-0001", "NXP-2026-APP-0003", "NXP-2026-APP-0004", "NXP-2026-APP-0009", "NXP-2026-APP-0006", "NXP-2026-APP-0007"]) {
  assert.equal(apparelCollection(apparel.find((item) => item.sku === sku)), "Nix Powell", sku);
}
for (const sku of ["NXP-2026-APP-0011", "NXP-2026-APP-0012"]) {
  assert.equal(apparelCollection(apparel.find((item) => item.sku === sku)), "Music Merch", sku);
}
assert.equal(apparelCollection({ label: "Music Merch" }), "Music Merch");
assert.equal(apparelCollection({ label: "Unknown" }), "");
const html = apparelPageMarkup(apparel, "Tops", "Nix Powell");
assert.match(html, /data-apparel-collection="Nix Powell" aria-pressed="true"/);
assert.match(html, /data-apparel-filter="Tops" aria-pressed="true"/);
assert.ok(html.indexOf("data-apparel-collection") < html.indexOf("data-apparel-filter"));
console.log("Apparel collection classification and filters passed.");

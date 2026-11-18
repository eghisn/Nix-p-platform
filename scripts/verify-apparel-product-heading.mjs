import assert from "node:assert/strict";
import { productCard } from "../src/components/layout.js";
import { apparelCardHeading, apparelCardType, productDisplayHeading } from "../src/data/productDisplay.js";
import { productMarkup } from "../api/_lib/catalogPage.js";

const apparel = {
  id: "motorith-crewneck-test",
  category: "Apparel",
  artist: "Motorith",
  title: "Crewneck Sweatshirt",
  condition: "New With Tags",
  price: 470000,
  qty: 1,
  image: "/public/nixp-logo.png"
};

assert.deepEqual(productDisplayHeading(apparel), {
  eyebrow: "Crewneck Sweatshirt",
  heading: "Motorith"
});

const apparelCard = productCard(apparel);
assert.match(apparelCard, /<p class="product-artist">Sweatshirt<\/p>/);
assert.match(apparelCard, /<h2><a[^>]+>Motorith<\/a><\/h2>/);
assert.match(apparelCard, /Rp\s*470\.000/);
assert.match(apparelCard, /data-add-cart="motorith-crewneck-test"[^>]*>Add to cart<\/button>/);

const apparelDetail = productMarkup(apparel);
assert.match(apparelDetail, /<p class="eyebrow">Crewneck Sweatshirt<\/p><h1>Motorith<\/h1>/);
assert.equal(apparelCardType({ title: "Paranoiac Odyssey T-shirt" }), "T-shirt");
assert.equal(apparelCardType({ title: "Cold Metal Breathes Too T-shirt" }), "T-shirt");
assert.equal(apparelCardType({ title: "Mesh Black Longsleeve" }), "Longsleeve");
assert.equal(apparelCardType({ title: "Mood Valiant", description: "Cotton T-shirt" }), "T-shirt");
assert.equal(apparelCardType({ title: "Mood Valiant", sku: "NXP-2026-APP-0011", description: "Cotton T-shirt" }), "Mood Valiant");
assert.equal(apparelCardType({ title: "Unknown item" }), "Unknown item");
for (const [sku, eyebrow, heading] of [
  ["NXP-2023-APP-0001", "Crewneck Sweatshirt", "Motorith"],
  ["NXP-2026-APP-0002", "Knitsweater", "Flesh"],
  ["NXP-2026-APP-0003", "T-shirt", "Preform"],
  ["NXP-2026-APP-0004", "Longsleeve", "Mesh"],
  ["NXP-2026-APP-0009", "Cap", "Lattice"],
  ["NXP-2026-APP-0010", "Nylon Cap", "Osculum"]
]) {
  const item = { ...apparel, sku };
  assert.deepEqual(apparelCardHeading(item), { eyebrow, heading });
  const card = productCard(item);
  assert.ok(card.includes(`<p class="product-artist">${eyebrow}</p>`));
  assert.ok(card.includes(`>${heading}</a></h2>`));
}

const record = { ...apparel, id: "record-test", category: "Records", artist: "Bauhaus", title: "Kick in the Eye" };
assert.deepEqual(productDisplayHeading(record), { eyebrow: "Bauhaus", heading: "Kick in the Eye" });
assert.match(productCard(record), /<p class="product-artist">Bauhaus<\/p>\s*<h2><a[^>]+>Kick in the Eye<\/a><\/h2>/);
assert.match(productMarkup(record), /<p class="eyebrow">Bauhaus<\/p><h1>Kick in the Eye<\/h1>/);

console.log("Apparel product heading contract passed.");

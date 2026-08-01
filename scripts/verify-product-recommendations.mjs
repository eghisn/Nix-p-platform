import fs from "node:fs";
import { recommendedProducts } from "../src/data/productRecommendations.js";
import { productCard } from "../src/components/layout.js";
import { artistCreditNames, artistIdentityKey } from "../src/data/catalogIdentity.js";

const store = JSON.parse(fs.readFileSync(new URL("../public/data/public-store.json", import.meta.url), "utf8"));
const arca = store.products.find((product) => product.artist === "Arca");

if (!arca) throw new Error("Arca product is missing from the public snapshot.");

const recommendations = recommendedProducts(arca, store.products);
const artists = recommendations.map((product) => product.artist);
const expected = ["SOPHIE", "Toxe", "Oneohtrix Point Never", "Amnesia Scanner"];

for (const artist of expected) {
  if (!artists.some((candidate) => candidate.toLowerCase().includes(artist.toLowerCase()))) {
    throw new Error(`Arca recommendation is missing ${artist}. Received: ${artists.join(", ")}`);
  }
}

const availableArtistNames = new Map();
for (const item of store.products.filter((item) => item.category === "Records")) {
  for (const artist of artistCreditNames(item.artist)) availableArtistNames.set(artistIdentityKey(artist), artist);
}
for (const item of recommendations) {
  const card = productCard(item, { availableArtistNames });
  const firstArtist = artistCreditNames(item.artist)[0];
  const expectedPath = `/artists/${artistIdentityKey(firstArtist)}`;
  if (!card.includes(`href="${expectedPath}"`) || !card.includes("data-product-artist-link")) {
    throw new Error(`Recommendation artist link is missing for ${item.artist}.`);
  }
}

if (new Set(artists).size !== artists.length) {
  throw new Error("Recommendations repeat the same artist.");
}

const signatures = new Set();
for (const product of store.products.filter((item) => item.category === "Records")) {
  const selection = recommendedProducts(product, store.products);
  if (selection.some((item) => item.id === product.id)) {
    throw new Error(`Recommendation includes its own product: ${product.id}`);
  }
  if (new Set(selection.map((item) => `${item.artist}:${item.title}`)).size !== selection.length) {
    throw new Error(`Recommendation repeats a release for ${product.id}`);
  }
  signatures.add(selection.map((item) => item.id).join("|"));
}

if (signatures.size < 8) {
  throw new Error("Recommendation output is not varied enough across the catalogue.");
}

console.log(`Recommendation integrity passed: ${artists.join(" | ")}; ${signatures.size} distinct shelves.`);

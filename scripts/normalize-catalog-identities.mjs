import { readFile, writeFile } from "node:fs/promises";
import { artistCreditNames, canonicalArtistName, canonicalLabelName, canonicalRelatedArtistName } from "../src/data/catalogIdentity.js";

const files = [
  "public/data/admin-store.json",
  "public/data/public-store.json",
  "exports/supabase/admin-store.json",
  "exports/supabase/public-store.json"
];

for (const file of files) {
  let store;
  try {
    store = JSON.parse(await readFile(file, "utf8"));
  } catch {
    continue;
  }

  store.products = (store.products || []).map((product) => ({
    ...product,
    artist: canonicalArtistName(product.artist),
    label: canonicalLabelName(product.label),
    collection: canonicalLabelName(product.collection || ""),
    relatedArtists: (product.relatedArtists || []).map(canonicalRelatedArtistName)
  }));

  const productArtists = store.products
    .filter((product) => product.category === "Records")
    .flatMap((product) => artistCreditNames(product.artist));
  const existing = (store.artists || []).filter((artist) => artist.status !== "Archived").map((artist) => canonicalArtistName(artist.name));
  const names = [...new Set([...existing, ...productArtists])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  store.artists = names.map((name, index) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
    bio: (store.artists || []).find((artist) => canonicalArtistName(artist.name) === name)?.bio || "",
    status: "Published",
    sort: index + 1
  }));

  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`Normalized ${file}: ${store.products.length} products, ${store.artists.length} artists`);
}

import { readFile, writeFile } from "node:fs/promises";

const productFiles = [
  "exports/supabase/products.json",
  "exports/supabase/public-products.json"
];

const osculumCap = {
  id: "nxp-2026-app-0010-osculum-nylon-black-polo-cap",
  sku: "NXP-2026-APP-0010",
  title: "Osculum Nylon Black Polo Cap",
  artist: "Cold Metal Breathes Too",
  category: "Apparel",
  format: "Apparel",
  displayFormat: "",
  apparelType: "Accessories",
  condition: "",
  qty: 12,
  price: 320000,
  year: 2026,
  label: "Nix Powell",
  collection: "Cold Metal Breathes Too",
  color: "Black",
  material: "Nylon",
  image: "/public/uploads/products/nxp-2026-app-0010-osculum-cap-1.jpg",
  images: [1, 2, 3, 4, 5].map((index) => `/public/uploads/products/nxp-2026-app-0010-osculum-cap-${index}.jpg`),
  imageCredits: [],
  tags: [],
  details: [],
  sizes: [],
  description:
    "Polo cap in nylon with front Osculum art embroidery and Tether art embroidered on the side\n\nRound crown\nCurved brim\nFront art embroidery\nSide art embroidery\nFive-part construction\nAdjustable strap at rear\n100% Nylon\nColor: Black",
  publishStatus: "Published",
  visibility: "Public",
  updatedAt: "2026-07-20",
  relatedArtists: [],
  homeCollections: [],
  homeSlideSort: null
};

function normalizeProducts(products = []) {
  return products.map((product) => {
    const normalized = { ...product };
    if (normalized.id === "nxp-2026-vnl-0002") normalized.artist = "Melt-Banana";
    if (normalized.id === "pub-001") normalized.qty = 0;
    if (normalized.category === "Records") {
      normalized.edition = String(normalized.edition || "").trim();
      if (String(normalized.condition || "").toLowerCase().startsWith("used")) {
        normalized.mediaCondition = String(normalized.mediaCondition || "").trim();
        normalized.sleeveCondition = String(normalized.sleeveCondition || "").trim();
      }
    }
    return normalized;
  });
}

function normalizeArtists(artists = []) {
  const corrected = artists
    .filter((artist) => !["rezzet", "melt banana"].includes(String(artist.name || "").trim().toLowerCase()))
    .concat([
      { id: "melt-banana", name: "Melt-Banana", bio: "", status: "Published", sort: 16 },
      { id: "rezzett", name: "Rezzett", bio: "", status: "Published", sort: 28 }
    ]);
  return [...new Map(corrected.map((artist) => [artist.id, artist])).values()].sort(
    (a, b) => Number(a.sort || 0) - Number(b.sort || 0)
  );
}

const storePath = "public/data/public-store.json";
const store = JSON.parse(await readFile(storePath, "utf8"));
if (!store.products.some((product) => product.id === osculumCap.id)) store.products.unshift(osculumCap);
store.products = normalizeProducts(store.products);
store.artists = normalizeArtists(store.artists);
await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);

for (const file of productFiles) {
  await writeFile(file, `${JSON.stringify(store.products, null, 2)}\n`);
}

const artistsPath = "exports/supabase/artists.json";
const artists = JSON.parse(await readFile(artistsPath, "utf8"));
await writeFile(artistsPath, `${JSON.stringify(normalizeArtists(artists), null, 2)}\n`);

const assetManifest = {
  generatedAt: new Date().toISOString(),
  coverImages: store.products
    .filter((product) => String(product.image || "").startsWith("/public/covers/"))
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      image: product.image,
      localPath: product.image.replace("/public/", "public/")
    })),
  uploadedProductImages: store.products
    .filter((product) => String(product.image || "").startsWith("/public/uploads/products/"))
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      image: product.image,
      localPath: product.image.replace("/public/", "public/")
    }))
};
await writeFile("exports/supabase/asset-manifest.json", `${JSON.stringify(assetManifest, null, 2)}\n`);

console.log("Normalized catalog fields, sold-out sample, artist names, and asset manifest.");

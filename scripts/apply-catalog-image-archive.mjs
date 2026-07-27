import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const storePath = path.join(root, "public", "data", "public-store.json");
const manifestPath = path.join(root, "work", "catalog-image-archive-manifest.json");
const store = JSON.parse(await fs.readFile(storePath, "utf8"));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const archiveBySource = new Map(
  (manifest.archived || []).map(({ source, target }) => [source, target.replace(/\.jpe?g$/i, ".webp")])
);
archiveBySource.set(
  "https://coverartarchive.org/release/ac2611e4-fa10-47f1-a328-8fad3c73cb49/front",
  "/public/assets/catalog-archive/nxp-2026-vnl-0027-cover.webp"
);

const mapImage = (value) => archiveBySource.get(value) || value;
for (const product of store.products || []) {
  product.image = mapImage(product.image);
  product.images = [...new Set((product.images || []).map(mapImage))];
  if (product.autoProductPhoto) product.autoProductPhoto = mapImage(product.autoProductPhoto);
  product.imageCredits = (product.imageCredits || []).map((credit) => ({ ...credit, image: mapImage(credit.image) }));
}

await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
process.stdout.write(`Updated ${store.products.length} catalog products.\n`);

import fs from "node:fs/promises";
import path from "node:path";
import { artistCreditNames, artistIdentityKey } from "../src/data/catalogIdentity.js";
import { isFinanceCatalogProduct, recordPublicationIssues } from "../src/data/catalogPublication.js";

const root = process.cwd();
const store = JSON.parse(await fs.readFile(path.join(root, "public", "data", "public-store.json"), "utf8"));
const issues = [];
const publicProducts = (store.products || []).filter((product) => product.publishStatus === "Published" && product.visibility === "Public");
const ids = new Set();
const curatedCoverSources = new Map([
  ["NXP-2026-VNL-0081", "Arca official Bandcamp artwork"],
  ["NXP-2026-VNL-0080", "Melvins official Bandcamp artwork"],
  ["NXP-2026-VNL-0079", "Sam Gendel official Bandcamp artwork"],
  ["NXP-2026-VNL-0078", "Cover Art Archive / Third Worlds / Harvest Records"],
  ["NXP-2026-VNL-0076", "Unknown Mortal Orchestra official Bandcamp artwork"],
  ["NXP-2026-VNL-0075", "Cover Art Archive / Dedicated Records"],
  ["NXP-2026-VNL-0073", "Apple Music / The Null Corporation artwork"],
  ["NXP-2026-VNL-0058", "Hyperdub official release artwork"],
  ["NXP-2026-VNL-0040", "Blondie album sleeve artwork"]
]);

function managedImage(value) {
  const image = String(value || "");
  return image.startsWith("/public/") || image.startsWith("/assets/") || /supabase\.co\/storage\/v1\/object\/public\//i.test(image);
}

for (const product of publicProducts) {
  if (!product.id || ids.has(product.id)) issues.push(`Duplicate or missing public product id: ${product.id || "(missing)"}`);
  ids.add(product.id);
  if (!managedImage(product.image)) issues.push(`${product.sku || product.id}: public main image is not NIXP-managed`);
  if ((product.images || []).some((image) => !managedImage(image))) issues.push(`${product.sku || product.id}: gallery contains an external image`);
  if (String(product.image || "").startsWith("/public/")) {
    const file = path.join(root, product.image.replace(/^\/public\//, "public/"));
    await fs.access(file).catch(() => issues.push(`${product.sku || product.id}: missing local image ${product.image}`));
  }
  if (product.category === "Records") {
    for (const [field, value] of Object.entries({ description: product.description })) {
      if (!value) issues.push(`${product.sku || product.id}: missing record editorial field ${field}`);
    }
    if (isFinanceCatalogProduct(product)) {
      for (const issue of recordPublicationIssues(product)) issues.push(`${product.sku || product.id}: unsafe finance publication missing ${issue}`);
    }
  }
}

for (const [sku, credit] of curatedCoverSources) {
  const product = publicProducts.find((candidate) => String(candidate.sku || "").toUpperCase() === sku);
  if (!product) {
    issues.push(`${sku}: missing curated public product`);
    continue;
  }
  if (!String(product.image || "").startsWith("/public/assets/catalog-archive/")) {
    issues.push(`${sku}: curated cover must be a local catalog archive asset`);
  }
  if (product.images?.length !== 1 || product.images[0] !== product.image) {
    issues.push(`${sku}: curated cover must be the sole storefront gallery image`);
  }
  if (product.imageCredits?.[0]?.image !== product.image || product.imageCredits?.[0]?.credit !== credit) {
    issues.push(`${sku}: curated cover credit drifted from its approved source`);
  }
}

const collaborations = publicProducts
  .filter((product) => product.category === "Records")
  .filter((product) => artistCreditNames(product.artist).length > 1);

const siouxsieCredits = artistCreditNames("Siouxsie & The Banshees");
if (siouxsieCredits.length !== 1 || artistIdentityKey(siouxsieCredits[0]) !== "siouxsie-and-the-banshees") {
  issues.push("Siouxsie And The Banshees must remain a single artist identity");
}

for (const product of collaborations) {
  const credits = artistCreditNames(product.artist);
  if (new Set(credits.map(artistIdentityKey)).size !== credits.length) issues.push(`${product.sku || product.id}: collaboration artist rule has duplicate identities`);
}

if (issues.length) {
  process.stderr.write(`Catalog integrity failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Catalog integrity passed: ${publicProducts.length} public products, ${collaborations.length} split collaborations, all images managed.\n`);

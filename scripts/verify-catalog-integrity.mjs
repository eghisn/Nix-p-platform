import fs from "node:fs/promises";
import path from "node:path";
import { artistCreditNames, artistIdentityKey } from "../src/data/catalogIdentity.js";
import { isFinanceCatalogProduct, recordPublicationIssues } from "../src/data/catalogPublication.js";

const root = process.cwd();
const store = JSON.parse(await fs.readFile(path.join(root, "public", "data", "public-store.json"), "utf8"));
const issues = [];
const publicProducts = (store.products || []).filter((product) => product.publishStatus === "Published" && product.visibility === "Public");
const ids = new Set();

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
    for (const [field, value] of Object.entries({ description: product.description, reviewQuote: product.reviewQuote, reviewSource: product.reviewSource, relatedArtists: product.relatedArtists?.length })) {
      if (!value) issues.push(`${product.sku || product.id}: missing record editorial field ${field}`);
    }
    if (isFinanceCatalogProduct(product)) {
      for (const issue of recordPublicationIssues(product)) issues.push(`${product.sku || product.id}: unsafe finance publication missing ${issue}`);
    }
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

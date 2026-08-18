import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { labelEntries } from "../src/data/labelCatalog.js";
import { verifiedLabelLogos } from "../src/data/labelLogoManifest.js";

const root = process.cwd();
const assetDirectory = path.join(root, "public", "labels");
const publicStore = JSON.parse(fs.readFileSync(path.join(root, "public", "data", "public-store.json"), "utf8"));
const placeholderSignature = /viewBox=["']0 0 240 120["'][\s\S]*?<circle cx=["']120["'] cy=["']60["']/i;
const forbiddenExtensions = new Set(["gif", "jpg", "jpeg"]);
const failures = [];

for (const [slug, logo] of Object.entries(verifiedLabelLogos)) {
  const assetPath = path.join(assetDirectory, `${logo.assetSlug || slug}.${logo.extension}`);
  if (!logo.source?.startsWith("https://")) failures.push(`${slug}: missing immutable source URL`);
  if (forbiddenExtensions.has(logo.extension)) failures.push(`${slug}: ${logo.extension} is not accepted for a transparent public logo`);
  if (!fs.existsSync(assetPath)) {
    failures.push(`${slug}: asset is missing (${assetPath})`);
    continue;
  }
  if (logo.extension === "svg") {
    const source = fs.readFileSync(assetPath, "utf8");
    if (placeholderSignature.test(source)) failures.push(`${slug}: generic placeholder artwork is not allowed`);
    if (/<image\s/i.test(source)) failures.push(`${slug}: embedded raster artwork requires a separate visual approval`);
    continue;
  }
  const metadata = await sharp(assetPath).metadata();
  if (!metadata.hasAlpha) failures.push(`${slug}: raster logo must have an alpha channel`);
  const stats = await sharp(assetPath).stats();
  if (!stats.channels.at(-1) || stats.channels.at(-1).max === 0) failures.push(`${slug}: raster logo is fully transparent`);
  const minimumWidth = logo.minimumRasterWidth || 200;
  const minimumHeight = logo.minimumRasterHeight || 60;
  if ((metadata.width || 0) < minimumWidth || (metadata.height || 0) < minimumHeight) failures.push(`${slug}: raster logo is too small (${metadata.width}x${metadata.height})`);
}

const available = new Set(Object.keys(verifiedLabelLogos));
const catalogueLabels = labelEntries(publicStore.products || []);
const missing = catalogueLabels.filter((label) => !available.has(label.slug));
if (missing.length) {
  console.warn(`Labels awaiting verified artwork (${missing.length}): ${missing.map((label) => label.name).join(", ")}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Verified ${Object.keys(verifiedLabelLogos).length} transparent label assets. ${missing.length} catalogue labels remain intentionally unpublished until their real marks are approved.`);

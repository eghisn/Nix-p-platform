import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const storePath = path.join(root, "public", "data", "public-store.json");
const outputDirectory = path.join(root, "public", "assets", "catalog-archive");
const store = JSON.parse(await fs.readFile(storePath, "utf8"));

await fs.mkdir(outputDirectory, { recursive: true });

function isExternalImage(value) {
  return /^https?:\/\//i.test(String(value || "")) && !String(value).includes("supabase.co");
}

function extensionFrom(contentType, url) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("avif")) return ".avif";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  const matched = String(url).match(/\.(jpe?g|png|webp|avif|gif)(?:$|[?#])/i);
  return matched ? `.${matched[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

const jobs = [];
for (const product of store.products || []) {
  const images = [product.image, ...(Array.isArray(product.images) ? product.images : [])]
    .map((image) => String(image || "").trim())
    .filter(isExternalImage);
  for (const [index, image] of [...new Set(images)].entries()) {
    jobs.push({ product, image, index });
  }
}

const archived = [];
const failures = [];
for (const { product, image, index } of jobs) {
  try {
    const response = await fetch(image, {
      redirect: "follow",
      headers: { "user-agent": "NIXP-Catalog-Archive/1.0 (contact@nix-p.com)", accept: "image/*" }
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !contentType.startsWith("image/")) {
      failures.push({ sku: product.sku, source: image, status: response.status, contentType });
      process.stdout.write(`${product.sku}: skipped (${response.status})\n`);
      continue;
    }
    const extension = extensionFrom(contentType, response.url || image);
    const base = `${String(product.sku || product.id).toLowerCase()}-${index === 0 ? "cover" : `detail-${index}`}`;
    const fileName = `${base}${extension}`;
    await fs.writeFile(path.join(outputDirectory, fileName), Buffer.from(await response.arrayBuffer()));
    archived.push({ sku: product.sku, source: image, target: `/public/assets/catalog-archive/${fileName}` });
    process.stdout.write(`${product.sku}: ${fileName}\n`);
  } catch (error) {
    failures.push({ sku: product.sku, source: image, error: error instanceof Error ? error.message : "Unknown error" });
    process.stdout.write(`${product.sku}: skipped (network error)\n`);
  }
}

await fs.writeFile(path.join(root, "work", "catalog-image-archive-manifest.json"), `${JSON.stringify({ archived, failures }, null, 2)}\n`);
process.stdout.write(`Archived ${archived.length} external catalog images; ${failures.length} need replacement.\n`);

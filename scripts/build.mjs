import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = process.cwd();
const dist = `${root}/dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ["index.html", "src", "public", "vercel.json"]) {
  if (existsSync(`${root}/${entry}`)) {
    await cp(`${root}/${entry}`, `${dist}/${entry}`, { recursive: true });
  }
}

await rm(`${dist}/public/data/admin-store.json`, { force: true });

const dataModule = `${dist}/src/data/sampleData.js`;
if (existsSync(dataModule)) {
  const source = await readFile(dataModule, "utf8");
  const sanitized = source
    .replace(/export const inventory = products\.map\(\(product, index\) => \(\{[\s\S]*?\}\)\);\r?\n/, "export const inventory = [];\n")
    .replace(/export const orders = \[[\s\S]*?\r?\n\];\r?\n/, "export const orders = [];\n")
    .replace(/export const requestItems = \[[\s\S]*?\r?\n\];\r?\n/, "export const requestItems = [];\n")
    .replace(/export const cashflow = \[[\s\S]*?\r?\n\];\r?\n/, "export const cashflow = [];\n");
  await writeFile(dataModule, sanitized);
}

const indexHtml = await readFile(`${dist}/index.html`, "utf8");
const publicStorePath = `${dist}/public/data/public-store.json`;
const publicStore = existsSync(publicStorePath) ? JSON.parse(await readFile(publicStorePath, "utf8")) : null;
const staticRoutes = [
  "records",
  "objects",
  "apparel",
  "publishing",
  "artists",
  "blog",
  "request-item",
  "about",
  "contact",
  "shipping-returns",
  "cart",
  "login",
  "admin",
  "admin/editor",
  "admin/products",
  "admin/media",
  "admin/artists",
  "admin/collections",
  "admin/requests",
  "admin/inventory",
  "admin/orders",
  "admin/cashflow",
  "admin/reports",
  "admin/preview"
];

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

for (const product of publicStore?.products || []) {
  staticRoutes.push(`product/${product.id}`);
  staticRoutes.push(`admin/preview/product/${product.id}`);
}

for (const artist of publicStore?.artists || []) {
  staticRoutes.push(`artists/${slugify(artist.name)}`);
}

for (const route of [...new Set(staticRoutes)]) {
  const routeDir = `${dist}/${route}`;
  await mkdir(routeDir, { recursive: true });
  await writeFile(`${routeDir}/index.html`, indexHtml);
}

console.log("Built NIXP prototype to dist/");

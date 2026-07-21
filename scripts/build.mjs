import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { build } from "esbuild";

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

await mkdir(`${dist}/assets`, { recursive: true });
await build({
  entryPoints: [`${dist}/src/main.js`],
  outfile: `${dist}/assets/app.js`,
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "none"
});

const indexHtml = (await readFile(`${dist}/index.html`, "utf8")).replace(
  /<script\s+type="module"\s+src="\/src\/main\.js[^"]*"><\/script>/i,
  '<script type="module" src="/assets/app.js?v=20260722-catalog-metadata"></script>'
);
const publicStorePath = `${dist}/public/data/public-store.json`;
const publicStore = existsSync(publicStorePath) ? JSON.parse(await readFile(publicStorePath, "utf8")) : null;
const siteOrigin = "https://www.nix-p.com";
const siteDescription = "A shifting selection of records, objects, publishing and apparel.";
const siteImage = `${siteOrigin}/public/assets/nixp-logo.png`;
const publicProducts = (publicStore?.products || []).filter(
  (product) => product.publishStatus === "Published" && product.visibility === "Public"
);
const staticRoutes = [
  "records",
  "objects",
  "apparel",
  "accessories",
  "accesories",
  "publishing",
  "artists",
  "blog",
  "request-item",
  "about",
  "contact",
  "shipping-returns",
  "cart",
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteUrl(value) {
  const path = String(value || "").trim();
  if (!path) return siteImage;
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteOrigin}${path.startsWith("/") ? "" : "/"}${path}`;
}

function replaceMeta(html, attribute, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+${attribute}="${escapedName}"\\s+content="[^"]*"\\s*\\/?>`, "i");
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(value)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
}

function routeDocument({ title, description, url, image, type = "website", crawlMarkup, structuredData }) {
  let html = indexHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = replaceMeta(html, "name", "description", description);
  html = replaceMeta(html, "property", "og:title", title);
  html = replaceMeta(html, "property", "og:description", description);
  html = replaceMeta(html, "property", "og:type", type);
  html = replaceMeta(html, "property", "og:url", url);
  html = replaceMeta(html, "property", "og:image", image);
  html = replaceMeta(html, "property", "og:image:secure_url", image);
  html = replaceMeta(html, "property", "og:image:alt", title);
  html = replaceMeta(html, "name", "twitter:card", "summary_large_image");
  html = replaceMeta(html, "name", "twitter:title", title);
  html = replaceMeta(html, "name", "twitter:description", description);
  html = replaceMeta(html, "name", "twitter:image", image);
  html = replaceMeta(html, "name", "twitter:image:alt", title);
  if (image !== siteImage) {
    html = html
      .replace(/\s*<meta\s+property="og:image:width"\s+content="[^"]*"\s*\/?>/i, "")
      .replace(/\s*<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/?>/i, "");
  }
  html = html.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${escapeHtml(url)}" />`);
  if (structuredData) {
    const json = JSON.stringify(structuredData).replaceAll("<", "\\u003c");
    html = html.replace("</head>", `    <script type="application/ld+json">${json}</script>\n  </head>`);
  }
  if (crawlMarkup) html = html.replace('<div id="app"></div>', `<div id="app"></div>\n    ${crawlMarkup}`);
  return html;
}

function crawlerSection(content) {
  return `<section aria-label="Catalog summary" style="position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important">${content}</section>`;
}

function homeDocument() {
  const catalogLinks = publicProducts
    .map(
      (product) =>
        `<li><a href="/product/${escapeHtml(product.id)}">${escapeHtml(product.artist)} - ${escapeHtml(product.title)} - ${escapeHtml(formatPrice(product.price))}</a></li>`
    )
    .join("");
  return routeDocument({
    title: "NIXP",
    description: siteDescription,
    url: `${siteOrigin}/`,
    image: siteImage,
    crawlMarkup: crawlerSection(`<h1>NIXP</h1><p>${escapeHtml(siteDescription)}</p><ul>${catalogLinks}</ul>`),
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Store",
      name: "NIXP",
      url: `${siteOrigin}/`,
      image: siteImage,
      description: siteDescription
    }
  });
}

function productDocument(product) {
  const url = `${siteOrigin}/product/${encodeURIComponent(product.id)}`;
  const image = absoluteUrl(product.image || product.images?.[0]);
  const price = formatPrice(product.price);
  const format = product.displayFormat || product.format || "Product";
  const description = `${product.artist} - ${product.title}. ${format}${product.condition ? ` / ${product.condition}` : ""}. ${price}.`;
  const inStock = productQuantity(product) > 0;
  return routeDocument({
    title: `${product.artist} - ${product.title} | NIXP`,
    description,
    url,
    image,
    type: "product",
    crawlMarkup: crawlerSection(
      `<article><h1>${escapeHtml(product.artist)} - ${escapeHtml(product.title)}</h1><p>${escapeHtml(description)}</p><p>${escapeHtml(product.description || "")}</p><a href="${escapeHtml(url)}">View product</a></article>`
    ),
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Product",
      name: `${product.artist} - ${product.title}`,
      sku: product.sku || product.id,
      image: (product.images?.length ? product.images : [product.image]).filter(Boolean).map(absoluteUrl),
      description: product.description || description,
      brand: { "@type": "Brand", name: "NIXP" },
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: "IDR",
        price: Number(product.price || 0),
        availability: `https://schema.org/${inStock ? "InStock" : "OutOfStock"}`
      }
    }
  });
}

function formatPrice(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  })
    .format(Number(value || 0))
    .replaceAll("\u00a0", " ");
}

function productQuantity(product = {}) {
  if (Array.isArray(product.sizes) && product.sizes.length) {
    return product.sizes.reduce(
      (sum, size) => sum + Math.max(0, Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) || 0),
      0
    );
  }
  return Math.max(0, Number(product.qty ?? 1) || 0);
}

await writeFile(`${dist}/index.html`, homeDocument());

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
  const productId = route.startsWith("product/") ? route.slice("product/".length) : "";
  const product = productId ? publicProducts.find((item) => item.id === productId) : null;
  const routeUrl = `${siteOrigin}/${route}`;
  const document = product
    ? productDocument(product)
    : routeDocument({
        title: route === "" ? "NIXP" : `${route.split("/").at(-1).replaceAll("-", " ")} | NIXP`,
        description: siteDescription,
        url: routeUrl,
        image: siteImage,
        crawlMarkup: crawlerSection(`<h1>NIXP</h1><p>${escapeHtml(siteDescription)}</p>`)
      });
  await writeFile(`${routeDir}/index.html`, document);
}

console.log("Built NIXP prototype to dist/");

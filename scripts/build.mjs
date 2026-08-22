import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
import sharp from "sharp";
import { productGrid, shell } from "../src/components/layout.js";
import { apparelPageMarkup, catalogGridPageMarkup } from "../src/components/catalogPage.js";
import { recordsPageMarkup } from "../src/components/recordsPage.js";
import { artistCreditNames } from "../src/data/catalogIdentity.js";
import { publicCategoryPath, publicProductPath } from "../src/data/publicUrls.js";
import { isRecentReleaseProduct, recentReleaseSortComparator } from "../src/data/homeCollections.js";
import { recommendedProducts } from "../src/data/productRecommendations.js";
import { termsOfUseContent } from "../src/data/termsOfUse.js";
import { labelEntries, productMatchesLabel } from "../src/data/labelCatalog.js";
import { labelLogoAvailable, verifiedLabelLogoExtensions } from "../src/data/labelLogoManifest.js";
import { labelProductsPageMarkup, labelsPageMarkup } from "../src/components/labelsPage.js";
import { canGenerateProductCardThumbnail, productCardThumbnailUrl, productCardThumbnailWidths } from "../src/data/productThumbnails.js";

const root = process.cwd();
const dist = `${root}/dist`;

async function collectApiEntries(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "_lib") return [];
        return collectApiEntries(path);
      }
      return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    })
  );
  return files.flat();
}

const apiEntries = await collectApiEntries(`${root}/api`);
await build({
  entryPoints: apiEntries,
  outdir: `${root}/.api-preflight`,
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  logLevel: "silent"
});

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
  outdir: `${dist}/assets`,
  bundle: true,
  format: "esm",
  splitting: true,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  target: "es2022",
  legalComments: "none"
});

const bundleUrl = "/assets/app.js?v=20260813-catalog-performance";
const indexHtml = (await readFile(`${dist}/index.html`, "utf8"))
  .replace(
    /<script\s+type="module"\s+src="\/src\/main\.js[^"]*"><\/script>/i,
    `<script type="module" src="${bundleUrl}"></script>`
  )
  .replace("</head>", `    <link rel="modulepreload" href="${bundleUrl}" />\n  </head>`);
const publicStorePath = `${dist}/public/data/public-store.json`;
const publicStore = existsSync(publicStorePath) ? JSON.parse(await readFile(publicStorePath, "utf8")) : null;
const siteOrigin = "https://www.nix-p.com";
const siteDescription = "A shifting selection of records, objects, publishing and apparel.";
const siteImage = `${siteOrigin}/public/assets/nixp-logo.png`;
const publicProducts = (publicStore?.products || []).filter(
  (product) =>
    product.publishStatus === "Published" &&
    product.visibility === "Public" &&
    product.image &&
    !(product.category === "Records" && product.image.includes("nixp-product-example"))
);

const thumbnailDirectory = `${dist}/product-thumbnails`;
await mkdir(thumbnailDirectory, { recursive: true });
const thumbnailProducts = publicProducts.filter(
  (product) => product.category === "Records" && canGenerateProductCardThumbnail(product)
);
for (let index = 0; index < thumbnailProducts.length; index += 4) {
  await Promise.all(
    thumbnailProducts.slice(index, index + 4).map(async (product) => {
      const sourceRelativePath = decodeURIComponent(String(product.image).split("?")[0]).replace(/^\/+/, "");
      const sourcePath = resolve(root, sourceRelativePath);
      const publicRoot = resolve(root, "public");
      if (!sourcePath.startsWith(`${publicRoot}${sep}`) || !existsSync(sourcePath)) return;
      await Promise.all(
        productCardThumbnailWidths.map((width) =>
          sharp(sourcePath)
            .rotate()
            .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 84, effort: 4 })
            .toFile(`${dist}${productCardThumbnailUrl(product, width)}`)
        )
      );
    })
  );
}
const publicLabels = labelEntries(publicProducts).filter((label) => labelLogoAvailable(label.slug));

// Keep the deployed label directory limited to verified real artwork. This prevents old
// placeholder marks from surviving in dist after the source manifest changes.
const labelAssetDirectory = `${dist}/public/labels`;
if (existsSync(labelAssetDirectory)) {
  const verifiedLabelFiles = new Set(
    Object.entries(verifiedLabelLogoExtensions).map(([slug, extension]) => `${slug}.${extension}`)
  );
  for (const filename of await readdir(labelAssetDirectory)) {
    if (!verifiedLabelFiles.has(filename)) await rm(`${labelAssetDirectory}/${filename}`, { force: true });
  }
}

// Serve verified label artwork from a dedicated root-level static directory. Some Vercel
// deployments do not expose newly-added nested files under /public consistently.
const labelStaticDirectory = `${dist}/label-assets`;
await rm(labelStaticDirectory, { recursive: true, force: true });
await mkdir(labelStaticDirectory, { recursive: true });
for (const [slug, extension] of Object.entries(verifiedLabelLogoExtensions)) {
  const source = `${root}/public/labels/${slug}.${extension}`;
  if (existsSync(source)) await cp(source, `${labelStaticDirectory}/${slug}.${extension}`);
}
const supplementalLabelAssets = ["cav-empt-source.png"];
for (const filename of supplementalLabelAssets) {
  const source = `${root}/public/labels/${filename}`;
  if (existsSync(source)) await cp(source, `${labelStaticDirectory}/${filename}`);
}

const staticRoutes = [
  "records",
  "objects",
  "apparel",
  "accessories",
  "publishing",
  "artists",
  "blog",
  "request-item",
  "make-an-offer",
  "about",
  "contact",
  "shipping-returns",
  "international-order",
  "terms-of-use",
  "cart",
  "order-status",
  "admin",
  "admin/editor",
  "admin/products",
  "admin/media",
  "admin/artists",
  "admin/collections",
  "admin/requests",
  "admin/inventory",
  "admin/orders",
  "admin/shipping",
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

function inventoryArtistMap(products) {
  const artists = new Map();
  for (const product of products || []) {
    if (product.category !== "Records") continue;
    const artist = String(product.artist || "").trim();
    if (!artist) continue;
    for (const credit of artistCreditNames(artist)) artists.set(slugify(credit), credit);
  }
  return artists;
}

function resolveInventoryArtist(artist, availableArtistNames) {
  if (!availableArtistNames) return "";
  for (const credit of artistCreditNames(artist)) {
    const match = availableArtistNames.get(slugify(credit));
    if (match) return match;
  }
  return "";
}

function artistSlug(value) {
  return slugify(value);
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

function routeDocument({ title, description, url, image, type = "website", appMarkup, crawlMarkup, structuredData }) {
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
  if (appMarkup) html = html.replace("<!-- NIXP_APP_MARKER -->", appMarkup);
  if (crawlMarkup) html = html.replace("</body>", `    ${crawlMarkup}\n  </body>`);
  return html;
}

function crawlerSection(content) {
  return `<section aria-label="Catalog summary" style="position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important">${content}</section>`;
}

function homeDocument() {
  const catalogLinks = publicProducts
    .map(
      (product) =>
        `<li><a href="${escapeHtml(publicProductPath(product))}">${escapeHtml(product.artist)} - ${escapeHtml(product.title)} - ${escapeHtml(formatPrice(product.price))}</a></li>`
    )
    .join("");
  return routeDocument({
    title: "NIXP",
    description: siteDescription,
    url: `${siteOrigin}/`,
    image: siteImage,
    appMarkup: homeAppMarkup(),
    crawlMarkup: crawlerSection(`<h1>NIXP</h1><p>${escapeHtml(siteDescription)}</p><ul>${catalogLinks}</ul>`),
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Store",
          "@id": `${siteOrigin}/#store`,
          name: "NIXP",
          url: `${siteOrigin}/`,
          image: siteImage,
          description: siteDescription
        },
        {
          "@type": "ItemList",
          name: "NIXP catalog",
          numberOfItems: publicProducts.length,
          itemListElement: publicProducts.map((product, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${siteOrigin}${publicProductPath(product)}`,
            name: `${product.artist} - ${product.title}`
          }))
        }
      ]
    }
  });
}

function homeAppMarkup() {
  const products = publicProducts
    .filter(isRecentReleaseProduct)
    .filter((product) => product.image && !product.image.includes("nixp-product-example"))
    .sort(recentReleaseSortComparator);
  const slides = [...products, ...products];
  const collections = [
    ["recent-releases", "Recent Releases"],
    ["nixp-selection", "NIXP Selection"],
    ["back-in-stock", "Back in Stock"],
    ["limited-pressing", "Limited Pressing"],
    ["private-collection", "Private Collection"]
  ];
  const content = `
    <section class="home-slider" aria-label="Product slider">
      <div class="home-collections" role="group" aria-label="Home collections">
        ${collections
          .map(
            ([id, label], index) =>
              `<button class="home-collection-button ${index === 0 ? "is-active" : ""}" type="button" data-home-collection="${id}">${label}</button>`
          )
          .join("")}
      </div>
      <div class="slider-viewport" data-home-slider-viewport aria-roledescription="carousel" aria-label="Automatic product slider. Drag or swipe to browse.">
        <div class="slider-track" data-home-slider-track>
          ${slides
            .map(
              (product, index) => `
                <article class="slide">
                  <a href="${escapeHtml(publicProductPath(product))}" data-link data-product-link>
                    <figure class="product-art slide-art"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" /></figure>
                    <div class="slide-caption">
                      <span>${String((index % products.length) + 1).padStart(2, "0")}</span>
                      <strong>${escapeHtml(product.artist)}</strong>
                      <em>${escapeHtml(product.title)}</em>
                    </div>
                  </a>
                </article>`
            )
            .join("")}
        </div>
      </div>
      <div class="slider-scrollbar" aria-label="Catalogue navigation">
        <button class="slider-scroll-button" type="button" aria-label="Previous catalogue items" data-home-slider-previous>&larr;</button>
        <div class="slider-scroll-rail" data-home-slider-control role="slider" aria-label="Browse catalogue" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="0" tabindex="0"><span class="slider-scroll-thumb" data-home-slider-thumb></span></div>
        <button class="slider-scroll-button" type="button" aria-label="Next catalogue items" data-home-slider-next>&rarr;</button>
      </div>
    </section>`;
  return shell(content, "/", 0);
}

function staticProductDetailMarkup(product) {
  const images = [...new Set((Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(Boolean))];
  const format = product.displayFormat || product.format || "Product";
  const isRecord = product.category === "Records";
  const isApparel = product.category === "Apparel";
  const soldOut = Number(product.qty || 0) <= 0;
  const isOfferOnly = product.open_to_offers === true;
  const availableArtistNames = inventoryArtistMap(publicProducts);
  const relatedMarkup = product.category === "Records" && Array.isArray(product.relatedArtists) && product.relatedArtists.length
    ? `<div class="related-artist-tags" aria-label="Related artists">${product.relatedArtists
        .map((artist) => String(artist || "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((artist) => {
          const inventoryArtist = resolveInventoryArtist(artist, availableArtistNames);
          const relatedSlug = inventoryArtist ? artistSlug(inventoryArtist) : "";
          return inventoryArtist
            ? `<a href="/artists/${relatedSlug}" data-link data-related-artist-link>${escapeHtml(artist)}</a>`
            : `<span>${escapeHtml(artist)}</span>`;
        })
        .join("")}</div>`
    : "";
  const legacyReview = product.reviewQuote
    ? `<blockquote class="product-review">“${escapeHtml(product.reviewQuote)}”</blockquote><p class="review-source">${escapeHtml(product.reviewSource || "Source review")}</p>`
    : "";
  const review = product.reviewQuote
    ? `<blockquote class="product-review"><p>&quot;${escapeHtml(product.reviewQuote)}&quot;</p><cite>${escapeHtml(product.reviewSource || "Source review")}</cite></blockquote>`
    : "";
  const details = isApparel
    ? `<div><dt>Material</dt><dd>${escapeHtml(product.material || "-")}</dd></div><div><dt>Color</dt><dd>${escapeHtml(product.color || "-")}</dd></div>`
    : `<div><dt>Format</dt><dd>${escapeHtml(format)}</dd></div><div><dt>Condition</dt><dd>${escapeHtml(product.condition || "Available")}</dd></div>${isRecord ? `<div><dt>Edition</dt><dd>${escapeHtml(product.edition || "Not specified")}</dd></div>` : ""}<div><dt>Label</dt><dd>${escapeHtml(product.label || "-")}</dd></div><div><dt>Year</dt><dd>${escapeHtml(product.year || "-")}</dd></div><div><dt>Notes</dt><dd>${escapeHtml((product.details || []).join(" / "))}</dd></div>`;
  const recommended = isRecord ? recommendedProducts(product, publicProducts) : [];
  const detail = `<section class="product-detail"><div class="detail-gallery">${images
    .map((image, index) => `<figure class="product-art product-art-large ${isApparel ? "product-art-apparel" : ""} ${soldOut ? "is-sold-out" : ""}"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}${images.length > 1 ? ` image ${index + 1}` : ""}" />${soldOut ? '<span class="sold-out-label">Sold out</span>' : ""}</figure>`)
    .join("")}</div><aside class="detail-copy"><a class="back-link" href="/${publicCategoryPath(product)}">${escapeHtml(product.category)}</a><p class="eyebrow">${escapeHtml(product.artist)}</p><h1>${escapeHtml(product.title)}</h1><div class="detail-price">${isOfferOnly ? "Private Collection / Offer Only" : escapeHtml(formatPrice(product.price))}</div><p class="product-description">${escapeHtml(product.description || "").replaceAll("\n", "<br />")}</p>${review}${relatedMarkup}<div class="detail-actions">${isOfferOnly ? `<a class="button button-dark" href="/make-an-offer?product=${encodeURIComponent(product.id)}" data-link>Make an Offer</a>` : `<button class="button button-dark" type="button" data-add-cart="${escapeHtml(product.id)}" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold out" : "Add to cart"}</button><a class="button button-outline" href="/request-item">Request similar</a>`}</div><dl class="detail-list">${details}</dl></aside></section>`;
  return `${detail}${recommended.length ? `<section class="section shop-section">${productGrid(recommended, { availableArtistNames })}</section>` : ""}`;
}

function productDocument(product) {
  const url = `${siteOrigin}${publicProductPath(product)}`;
  const image = absoluteUrl(product.image || product.images?.[0]);
  const price = formatPrice(product.price);
  const format = product.displayFormat || product.format || "Product";
  const description = product.open_to_offers
    ? `${product.artist} - ${product.title}. Private Collection item available by offer. Minimum Acceptable Offer is reviewed by NIXP after submission.`
    : `${product.artist} - ${product.title}. ${format}${product.condition ? ` / ${product.condition}` : ""}. ${price}.`;
  const inStock = productQuantity(product) > 0;
  const barcode = String(product.barcode || "").replace(/\D/g, "");
  const itemCondition = /^used\b/i.test(String(product.condition || "")) ? "UsedCondition" : "NewCondition";
  const productData = {
    "@type": "Product",
    "@id": `${url}#product`,
    name: `${product.artist} - ${product.title}`,
    sku: product.sku || product.id,
    image: (product.images?.length ? product.images : [product.image]).filter(Boolean).map(absoluteUrl),
    description: product.description || description,
    category: `${product.category || "Catalog"} > ${format}`,
    brand: { "@type": "Brand", name: product.label || "NIXP" },
    ...(barcode.length === 13 ? { gtin13: barcode } : {}),
    ...(barcode.length === 12 ? { gtin12: barcode } : {}),
    ...(product.catalogNumber ? { mpn: product.catalogNumber } : {}),
    ...(product.open_to_offers ? {} : {
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: "IDR",
        price: Number(product.price || 0),
        availability: `https://schema.org/${inStock ? "InStock" : "OutOfStock"}`,
        itemCondition: `https://schema.org/${itemCondition}`,
        seller: { "@type": "Organization", name: "NIXP", url: `${siteOrigin}/` }
      }
    })
  };
  return routeDocument({
    title: `${product.artist} - ${product.title} | NIXP`,
    description,
    url,
    image,
    type: "product",
    appMarkup: shell(staticProductDetailMarkup(product), publicProductPath(product), 0),
    crawlMarkup: crawlerSection(
      `<article><h1>${escapeHtml(product.artist)} - ${escapeHtml(product.title)}</h1><p>${escapeHtml(description)}</p><p>${escapeHtml(product.description || "")}</p><a href="${escapeHtml(url)}">View product</a></article>`
    ),
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        productData,
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "NIXP", item: `${siteOrigin}/` },
            { "@type": "ListItem", position: 2, name: product.category || "Catalog", item: `${siteOrigin}/${slugify(product.category || "records")}` },
            { "@type": "ListItem", position: 3, name: `${product.artist} - ${product.title}`, item: url }
          ]
        }
      ]
    }
  });
}

function staticPublicRouteMarkup(route) {
  const productsByCategory = (category) => publicProducts.filter((product) => product.category === category);
  if (route.startsWith("admin/")) {
    return `<section class="section"><div class="app-boot" aria-live="polite">NIXP ADMIN</div></section>`;
  }
  if (route === "records") {
    const records = [...productsByCategory("Records")].sort((left, right) => left.artist.localeCompare(right.artist));
    return recordsPageMarkup({
      records,
      availableArtistNames: inventoryArtistMap(publicProducts)
    });
  }
  if (route === "objects") return catalogGridPageMarkup(productsByCategory("Objects"));
  if (route === "apparel") return apparelPageMarkup(productsByCategory("Apparel"));
  if (route === "accessories" || route === "accesories") return apparelPageMarkup(productsByCategory("Accessories"), "Accessories");
  if (route === "publishing") return catalogGridPageMarkup(productsByCategory("Publishing"));
  if (route === "labels") return labelsPageMarkup(publicLabels);
  if (route.startsWith("labels/")) {
    const label = publicLabels.find((entry) => entry.slug === route.slice("labels/".length));
    if (!label) return `<section class="section"><div class="app-boot" aria-live="polite">NIXP</div></section>`;
    const products = publicProducts.filter((product) => productMatchesLabel(product, label.slug));
    return labelProductsPageMarkup(label, products, { availableArtistNames: inventoryArtistMap(publicProducts) });
  }
  if (route === "blog") {
    const articles = [
      ["01", "Listening Notes: The First NIXP Selection", "Editorial", "2026", "A short introduction to the records, CDs, cassettes, books and objects shaping the first NIXP catalog."],
      ["02", "Inside Aesthetic Pleasure Gallery", "Place", "2026", "Notes from the listening space, the shop table, and the culture around the gallery floor."],
      ["03", "Format Notes: Vinyl, CD, Cassette", "Guide", "2026", "A practical media index for collectors moving between physical formats."]
    ];
    return `<section class="section editorial-page blog-page">
      <div class="editorial-shell">
        <h1>Blog</h1>
        <div class="blog-list">
          ${articles
            .map(
              ([number, title, type, date, summary]) => `<article class="blog-row">
                <span>${number} / ${type} / ${date}</span>
                <div>
                  <h2>${escapeHtml(title)}</h2>
                  <p>${escapeHtml(summary)}</p>
                </div>
                <a href="#" aria-label="Read ${escapeHtml(title)}">Read</a>
              </article>`
            )
            .join("")}
        </div>
      </div>
    </section>`;
  }
  if (route === "request-item") {
    return `<section class="section form-layout">
      <form class="request-form" data-request-form>
        <label>Artist Name:<input name="artistName" required /></label>
        <label>Title / Item Name:<input name="itemName" required /></label>
        <label>Format:
          <select name="format" required>
            ${["Vinyl", "CD", "Cassette", "Book", "Magazine", "Object", "Apparel", "Other"].map((format) => `<option>${format}</option>`).join("")}
          </select>
        </label>
        <label>Email:<input name="email" type="email" autocomplete="email" required /></label>
        <label>WhatsApp:<input name="whatsapp" /></label>
        <label>Notes:<textarea name="notes" rows="5"></textarea></label>
        <input class="request-honeypot" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <button class="button button-dark" type="submit">Submit request</button>
      </form>
      <aside class="status-panel">
        <p class="eyebrow">Request status</p>
        <div class="status-stack">
          ${["New", "Searching", "Found", "Unavailable", "Contacted", "Closed"].map((status) => `<span>${status}</span>`).join("")}
        </div>
        <div class="mini-list"></div>
      </aside>
    </section>`;
  }
  if (route === "make-an-offer") {
    return `<section class="section editorial-page"><div class="editorial-shell"><h1>Make an Offer</h1><p>Select a Private Collection item to submit an offer.</p></div></section>`;
  }
  if (route === "about") {
    return `<section class="section editorial-page">
      <div class="editorial-shell">
        <h1>About</h1>
        <div class="editorial-copy">
          <p>NIXP is an extension of Nix Powell, built around a growing catalogue of records, tapes, discs, printed matter, and objects selected through personal taste, research, and repeat listening.</p>
          <p>The focus moves across experimental music, heavy music, electronic music, contemporary composition, independent publishing, and their surrounding edges.</p>
          <p>Based online and operating from Aesthetic Pleasure Gallery, Grand Wijaya Center, Jakarta.</p>
        </div>
      </div>
    </section>`;
  }
  if (route === "contact") {
    return `<section class="section editorial-page contact-page">
      <div class="editorial-shell">
        <h1>Contact</h1>
        <div class="editorial-copy contact-copy">
          <address>Aesthetic Pleasure Gallery Wijaya Grand Centre, Jl. Darmawangsa Raya Blok G 9 2rd Floor, RT.6/RW.1, Pulo, Kebayoran Baru, South Jakarta City, Jakarta 12160</address>
          <p><a href="https://wa.me/6282122876289">+628 2122 8762 89</a><br><a href="mailto:contact@nix-p.com">contact@nix-p.com</a></p>
        </div>
      </div>
    </section>`;
  }
  if (route === "shipping-returns") {
    return `<section class="section editorial-page">
      <div class="editorial-shell">
        <h1>Shipping &amp; Returns</h1>
        <div class="editorial-copy">
          <p>Shipping rates, fulfillment windows, and return terms will be connected once checkout and inventory are live.</p>
          <p>For now, customers can contact NIXP directly for availability, local pickup, and item condition questions.</p>
        </div>
      </div>
    </section>`;
  }
  if (route === "international-order") {
    return `<section class="section editorial-page contact-page">
      <div class="editorial-shell">
        <h1>International Orders</h1>
        <div class="editorial-copy contact-copy">
          <p>Online checkout is currently available for delivery within Indonesia only. For an international order, contact NIXP directly with the item name, your destination country, and postal code.</p>
          <p><a href="mailto:contact@nix-p.com?subject=International%20order%20enquiry">contact@nix-p.com</a><br><a href="https://wa.me/6282122876289?text=Hello%20NIXP%2C%20I%20would%20like%20to%20arrange%20an%20international%20order.">WhatsApp NIXP</a></p>
        </div>
      </div>
    </section>`;
  }
  if (route === "terms-of-use") {
    return `<section class="section editorial-page terms-page">
      <div class="editorial-shell terms-shell">
        <h1>Terms of Use</h1>
        ${termsOfUseContent}
      </div>
    </section>`;
  }
  if (route === "cart") {
    return `<section class="section cart-view">
      <p class="empty-state">Your cart is empty.</p>
      <div class="cart-total cart-totals" aria-label="Order total">
        <span>Items</span><strong>Rp 0</strong>
        <span>Delivery</span><em>Quoted after address confirmation</em>
        <span>Total at payment</span><strong>Rp 0 + delivery</strong>
      </div>
    </section>`;
  }
  return `<section class="section"><div class="app-boot" aria-live="polite">NIXP</div></section>`;
}

function staticRouteTitle(route) {
  const titles = {
    records: "Records",
    objects: "Objects",
    apparel: "Apparel",
    accessories: "Accessories",
    accesories: "Accessories",
    publishing: "Publishing",
    labels: "Labels",
    blog: "Blog",
    "request-item": "Request Item",
    "make-an-offer": "Make an Offer",
    about: "About",
    contact: "Contact",
    "shipping-returns": "Shipping & Returns",
    "international-order": "International Orders",
    "terms-of-use": "Terms of Use",
    cart: "Cart"
  };
  return titles[route] || (route ? route.split("/").at(-1).replaceAll("-", " ") : "NIXP");
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

function artistDocument(artist) {
  const availableArtistNames = inventoryArtistMap(publicProducts);
  const products = publicProducts.filter(
    (product) =>
      ["Records", "Apparel"].includes(product.category) &&
      artistCreditNames(product.artist).some((credit) => slugify(credit) === slugify(artist.name))
  );
  const appMarkup = shell(
    `<section class="section shop-section artist-products">
      <div class="toolbar artist-toolbar"><a class="back-link" href="/artists" data-link>Artists</a><span>${escapeHtml(artist.name)}</span></div>
      ${productGrid(products, { availableArtistNames })}
    </section>`,
    `/artists/${slugify(artist.name)}`,
    0
  );
  return routeDocument({
    title: `${artist.name} | NIXP`,
    description: `${artist.name} releases available from NIXP.`,
    url: `${siteOrigin}/artists/${slugify(artist.name)}`,
    image: siteImage,
    appMarkup,
    crawlMarkup: crawlerSection(`<h1>${escapeHtml(artist.name)}</h1><p>Releases by ${escapeHtml(artist.name)} available from NIXP.</p>`),
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${artist.name} releases at NIXP`,
      url: `${siteOrigin}/artists/${slugify(artist.name)}`,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: products.length,
        itemListElement: products.map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${siteOrigin}${publicProductPath(product)}`,
          name: `${product.artist} - ${product.title}`
        }))
      }
    }
  });
}

function artistsIndexMarkup(artists) {
  return `<section class="section artist-list">
    ${artists
      .map(
        (artist) => `
          <article class="artist-row">
            <a href="/artists/${slugify(artist)}" data-link>
              <h2>${escapeHtml(artist)}</h2>
              <span>View products</span>
            </a>
          </article>
        `
      )
      .join("")}
  </section>`;
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

const productRoutes = new Map();
for (const product of publicProducts) {
  const canonicalRoute = publicProductPath(product).replace(/^\//, "");
  if (productRoutes.has(canonicalRoute)) {
    throw new Error(`Duplicate public product URL: /${canonicalRoute}`);
  }
  productRoutes.set(canonicalRoute, product);
}

for (const product of publicStore?.products || []) {
  staticRoutes.push(`admin/preview/product/${product.id}`);
}

const artistDirectory = new Map();
const recordArtistKeys = new Set(
  publicProducts.filter((product) => product.category === "Records").flatMap((product) => artistCreditNames(product.artist).map(slugify)).filter(Boolean)
);
for (const artist of publicStore?.artists || []) {
  const slug = slugify(artist.name);
  if (recordArtistKeys.has(slug)) artistDirectory.set(slug, artist.name);
}
for (const product of publicProducts.filter((product) => product.category === "Records")) {
  for (const artistName of artistCreditNames(product.artist)) artistDirectory.set(slugify(artistName), artistName);
}
for (const route of [...new Set(staticRoutes)]) {
  const routeDir = `${dist}/${route}`;
  await mkdir(routeDir, { recursive: true });
  const product = productRoutes.get(route) || null;
  const routeUrl = `${siteOrigin}/${route}`;
  const artistSlugPath = route.startsWith("artists/") ? route.slice("artists/".length) : "";
  const artistName = artistSlugPath ? artistDirectory.get(artistSlugPath) : "";
  const labelSlugPath = route.startsWith("labels/") ? route.slice("labels/".length) : "";
  const labelEntry = labelSlugPath ? publicLabels.find((entry) => entry.slug === labelSlugPath) : null;
  const document = product
    ? productDocument(product)
    : artistName
      ? artistDocument({ name: artistName })
      : route === "artists"
        ? routeDocument({
            title: "Artists | NIXP",
            description: siteDescription,
            url: routeUrl,
            image: siteImage,
            appMarkup: shell(artistsIndexMarkup([...artistDirectory.values()]), "/artists", 0),
            crawlMarkup: crawlerSection(`<h1>Artists</h1>${[...artistDirectory.values()].map((artist) => `<p><a href="/artists/${slugify(artist)}">${escapeHtml(artist)}</a></p>`).join("")}`)
            })
      : route === "labels" || labelEntry
        ? routeDocument({
            title: labelEntry ? `${labelEntry.name} | Labels | NIXP` : "Labels | NIXP",
            description: labelEntry ? `${labelEntry.name} releases available from NIXP.` : "Record labels represented in the NIXP catalogue.",
            url: routeUrl,
            image: siteImage,
            appMarkup: shell(staticPublicRouteMarkup(route), `/${route}`, 0),
            crawlMarkup: crawlerSection(`<h1>${escapeHtml(labelEntry?.name || "Labels")}</h1><p>${escapeHtml(labelEntry ? `${labelEntry.name} releases available from NIXP.` : "Record labels represented in the NIXP catalogue.")}</p>`)
          })
      : routeDocument({
          title: `${staticRouteTitle(route)}${route ? " | NIXP" : ""}`,
          description: siteDescription,
          url: routeUrl,
          image: siteImage,
          appMarkup: shell(staticPublicRouteMarkup(route), `/${route}`, 0),
          crawlMarkup: crawlerSection(`<h1>NIXP</h1><p>${escapeHtml(siteDescription)}</p>`)
        });
  await writeFile(`${routeDir}/index.html`, document);
}

const generatedRoutes = [...new Set(staticRoutes)];
const missingRoutes = generatedRoutes.filter((route) => !existsSync(`${dist}/${route}/index.html`));
if (missingRoutes.length) {
  throw new Error(`Static route generation failed for: ${missingRoutes.join(", ")}`);
}

const crawlableRoutes = [
  "",
  "records",
  "objects",
  "apparel",
  "accessories",
  "publishing",
  "artists",
  "labels",
  "blog",
  "request-item",
  "make-an-offer",
  "about",
  "contact",
  "shipping-returns",
  "international-order",
  "terms-of-use",
  ...publicProducts.map((product) => publicProductPath(product).replace(/^\//, "")),
  ...[...artistDirectory.keys()].map((artistSlug) => `artists/${artistSlug}`),
  ...publicLabels.map((label) => `labels/${label.slug}`)
];
const sitemapEntries = [...new Set(crawlableRoutes)]
  .map((route) => `  <url><loc>${escapeHtml(`${siteOrigin}/${route}`)}</loc></url>`)
  .join("\n");
await writeFile(
  `${dist}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`
);
await writeFile(
  `${dist}/robots.txt`,
  `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /finance/\nDisallow: /login\n\nSitemap: ${siteOrigin}/sitemap.xml\n`
);

console.log("Built NIXP prototype to dist/");

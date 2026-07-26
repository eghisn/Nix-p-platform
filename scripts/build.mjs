import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { productGrid, shell } from "../src/components/layout.js";

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

const bundleUrl = "/assets/app.js?v=20260725-founders-webfont";
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

function artistKeys(value) {
  const name = String(value || "").trim().toLowerCase();
  const slug = slugify(value);
  return [...new Set([name, slug].filter(Boolean))];
}

function inventoryArtistMap(products) {
  const artists = new Map();
  for (const product of products || []) {
    if (product.category !== "Records") continue;
    const artist = String(product.artist || "").trim();
    if (!artist) continue;
    for (const key of artistKeys(artist)) artists.set(key, artist);
  }
  return artists;
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
        `<li><a href="/product/${escapeHtml(product.id)}">${escapeHtml(product.artist)} - ${escapeHtml(product.title)} - ${escapeHtml(formatPrice(product.price))}</a></li>`
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
            url: `${siteOrigin}/product/${encodeURIComponent(product.id)}`,
            name: `${product.artist} - ${product.title}`
          }))
        }
      ]
    }
  });
}

function homeAppMarkup() {
  const products = publicProducts
    .filter(
      (product) =>
        product.category === "Records" &&
        ["Vinyl", "CD", "Cassette"].includes(product.format) &&
        [2025, 2026].includes(Number(product.year))
    )
    .filter((product) => product.image && !product.image.includes("nixp-product-example"))
    .sort((a, b) => {
      const sortA = Number.isFinite(Number(a.homeSlideSort)) ? Number(a.homeSlideSort) : 9999;
      const sortB = Number.isFinite(Number(b.homeSlideSort)) ? Number(b.homeSlideSort) : 9999;
      return sortA - sortB || String(a.artist || "").localeCompare(String(b.artist || ""));
    });
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
                  <a href="/product/${escapeHtml(product.id)}" data-link>
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

function productDocument(product) {
  const url = `${siteOrigin}/product/${encodeURIComponent(product.id)}`;
  const image = absoluteUrl(product.image || product.images?.[0]);
  const price = formatPrice(product.price);
  const format = product.displayFormat || product.format || "Product";
  const description = `${product.artist} - ${product.title}. ${format}${product.condition ? ` / ${product.condition}` : ""}. ${price}.`;
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
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "IDR",
      price: Number(product.price || 0),
      availability: `https://schema.org/${inStock ? "InStock" : "OutOfStock"}`,
      itemCondition: `https://schema.org/${itemCondition}`,
      seller: { "@type": "Organization", name: "NIXP", url: `${siteOrigin}/` }
    }
  };
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
    (product) => product.category === "Records" && slugify(product.artist) === slugify(artist.name)
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
          url: `${siteOrigin}/product/${encodeURIComponent(product.id)}`,
          name: `${product.artist} - ${product.title}`
        }))
      }
    }
  });
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

for (const product of publicProducts) {
  staticRoutes.push(`product/${product.id}`);
}

for (const product of publicStore?.products || []) {
  staticRoutes.push(`admin/preview/product/${product.id}`);
}

const artistDirectory = new Map();
const recordArtistKeys = new Set(
  publicProducts.filter((product) => product.category === "Records").map((product) => slugify(product.artist)).filter(Boolean)
);
for (const artist of publicStore?.artists || []) {
  const slug = slugify(artist.name);
  if (recordArtistKeys.has(slug)) artistDirectory.set(slug, artist.name);
}
for (const product of publicProducts.filter((product) => product.category === "Records")) {
  if (product.artist) artistDirectory.set(slugify(product.artist), product.artist);
}
for (const artistSlug of artistDirectory.keys()) staticRoutes.push(`artists/${artistSlug}`);

for (const route of [...new Set(staticRoutes)]) {
  const routeDir = `${dist}/${route}`;
  await mkdir(routeDir, { recursive: true });
  const productId = route.startsWith("product/") ? route.slice("product/".length) : "";
  const product = productId ? publicProducts.find((item) => item.id === productId) : null;
  const routeUrl = `${siteOrigin}/${route}`;
  const artistSlugPath = route.startsWith("artists/") ? route.slice("artists/".length) : "";
  const artistName = artistSlugPath ? artistDirectory.get(artistSlugPath) : "";
  const document = product
    ? productDocument(product)
    : artistName
      ? artistDocument({ name: artistName })
      : routeDocument({
          title: route === "" ? "NIXP" : `${route.split("/").at(-1).replaceAll("-", " ")} | NIXP`,
          description: siteDescription,
          url: routeUrl,
          image: siteImage,
          appMarkup: shell(`<section class="section"><div class="app-boot" aria-live="polite">NIXP</div></section>`, `/${route}`, 0),
          crawlMarkup: crawlerSection(`<h1>NIXP</h1><p>${escapeHtml(siteDescription)}</p>`)
        });
  await writeFile(`${routeDir}/index.html`, document);
}

const crawlableRoutes = [
  "",
  "records",
  "objects",
  "apparel",
  "accessories",
  "publishing",
  "artists",
  "blog",
  "request-item",
  "about",
  "contact",
  "shipping-returns",
  ...publicProducts.map((product) => `product/${product.id}`),
  ...[...artistDirectory.keys()].map((artistSlug) => `artists/${artistSlug}`)
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

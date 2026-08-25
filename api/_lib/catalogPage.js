import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { productGrid, shell } from "../../src/components/layout.js";
import { artistCreditNames, artistIdentityKey } from "../../src/data/catalogIdentity.js";
import { publicCategoryPath, publicProductPath } from "../../src/data/publicUrls.js";
import { labelEntries, productMatchesLabel } from "../../src/data/labelCatalog.js";
import { labelLogoAvailable } from "../../src/data/labelLogoManifest.js";
import { labelProductsPageMarkup, labelsPageMarkup } from "../../src/components/labelsPage.js";
import { loadStore } from "./supabase.js";

const ORIGIN = "https://www.nix-p.com";
const BUNDLE_URL = "/assets/app.js?v=20260813-catalog-performance";

export async function renderCatalogPage(req, res, url) {
  try {
    const requestedPath = normalizePath(url.searchParams.get("catalogPath"));
    const protocol = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0];
    const host = String(req.headers?.host || "www.nix-p.com").split(",")[0];
    const store = await loadStore({ publicSnapshotUrl: `${protocol}://${host}/public/data/public-store.json` });
    if (requestedPath === "/artists") {
      return renderArtistsIndexPage(res, store);
    }
    if (requestedPath.startsWith("/artists/")) {
      return renderArtistPage(res, store, requestedPath);
    }
    if (requestedPath === "/labels") {
      return renderLabelsIndexPage(res, store);
    }
    if (requestedPath.startsWith("/labels/")) {
      return renderLabelPage(res, store, requestedPath);
    }
    const product = (store.products || []).find((item) => publicProductPath(item) === requestedPath);
    if (!product) return notFound(res);

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    sendPublicSnapshotHeaders(res);
    res.end(await productDocument(product, requestedPath, store));
  } catch {
    notFound(res);
  }
}

async function renderArtistsIndexPage(res, store) {
  const records = (store.products || []).filter((product) => product.category === "Records");
  const artists = [...new Map(records.flatMap((product) => artistCreditNames(product.artist).map((artist) => [slugify(artist), artist]))).values()].sort((left, right) => left.localeCompare(right));
  const document = await pageDocument({
    title: "Artists | NIXP",
    description: "Artists with releases available from NIXP.",
    canonicalUrl: `${ORIGIN}/artists`,
    image: `${ORIGIN}/public/nixp-logo.png`,
    appMarkup: shell(`<section class="section artist-list">${artists.map((artist) => `<article class="artist-row"><a href="/artists/${slugify(artist)}" data-link><h2>${escapeHtml(artist)}</h2><span>View products</span></a></article>`).join("")}</section>`, "/artists", 0)
  });
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  sendPublicSnapshotHeaders(res);
  res.end(document);
}

async function renderArtistPage(res, store, requestedPath) {
  const slug = requestedPath.slice("/artists/".length);
  const records = (store.products || []).filter((product) => product.category === "Records");
  const artistName = records.flatMap((product) => artistCreditNames(product.artist)).find((artist) => slugify(artist) === slug);
  if (!artistName) return notFound(res);
  const products = (store.products || []).filter((product) =>
    ["Records", "Apparel"].includes(product.category) &&
    artistCreditNames(product.artist).some((artist) => slugify(artist) === slug)
  );
  const availableArtistNames = new Map(records.flatMap((product) => artistCreditNames(product.artist).map((artist) => [slugify(artist), artist])));
  const document = await pageDocument({
    title: `${artistName} | NIXP`,
    description: `${artistName} releases available from NIXP.`,
    canonicalUrl: `${ORIGIN}${requestedPath}`,
    image: absoluteUrl(products[0]?.image),
    appMarkup: shell(`<section class="section shop-section artist-products"><div class="toolbar artist-toolbar"><a class="back-link" href="/artists" data-link>Artists</a><span>${escapeHtml(artistName)}</span></div>${productGrid(products, { availableArtistNames })}</section>`, requestedPath, 0)
  });
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  sendPublicSnapshotHeaders(res);
  res.end(document);
}

async function renderLabelsIndexPage(res, store) {
  const labels = labelEntries(store.products || []).filter((label) => labelLogoAvailable(label.slug));
  const document = await pageDocument({
    title: "Labels | NIXP",
    description: "Record labels represented in the NIXP catalogue.",
    canonicalUrl: `${ORIGIN}/labels`,
    image: `${ORIGIN}/public/nixp-logo.png`,
    appMarkup: shell(labelsPageMarkup(labels), "/labels", 0)
  });
  sendNoStoreHtml(res, document);
}

async function renderLabelPage(res, store, requestedPath) {
  const slug = requestedPath.slice("/labels/".length);
  const labels = labelEntries(store.products || []).filter((label) => labelLogoAvailable(label.slug));
  const label = labels.find((entry) => entry.slug === slug);
  if (!label) return notFound(res);
  const products = (store.products || []).filter((product) => productMatchesLabel(product, label.slug));
  const records = (store.products || []).filter((product) => product.category === "Records");
  const availableArtistNames = new Map(
    records.flatMap((product) => artistCreditNames(product.artist).map((artist) => [artistIdentityKey(artist), artist]))
  );
  const document = await pageDocument({
    title: `${label.name} | Labels | NIXP`,
    description: `${label.name} releases available from NIXP.`,
    canonicalUrl: `${ORIGIN}${requestedPath}`,
    image: `${ORIGIN}/public/nixp-logo.png`,
    appMarkup: shell(labelProductsPageMarkup(label, products, { availableArtistNames }), requestedPath, 0)
  });
  sendNoStoreHtml(res, document);
}

function sendNoStoreHtml(res, document) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  sendPublicSnapshotHeaders(res);
  res.end(document);
}

function sendPublicSnapshotHeaders(res) {
  // Every public document is generated from the deployment's immutable
  // editorial snapshot. Browser requests revalidate at navigation time, while
  // the Vercel CDN can serve that exact deployment revision immediately.
  res.setHeader("cache-control", "public, max-age=0, must-revalidate");
  res.setHeader("cdn-cache-control", "public, s-maxage=31536000, immutable");
  res.setHeader("vercel-cdn-cache-control", "public, s-maxage=31536000, immutable");
}

async function productDocument(product, path, store) {
  const title = `${product.artist} - ${product.title} | NIXP`;
  const format = product.displayFormat || product.format || "Product";
  const price = formatPrice(product.price);
  const description = product.open_to_offers
    ? `${product.artist} - ${product.title}. Private Collection item available by offer.`
    : `${product.artist} - ${product.title}. ${format}${product.condition ? ` / ${product.condition}` : ""}. ${price}.`;
  const image = absoluteUrl(product.image || product.images?.[0]);
  const canonicalUrl = `${ORIGIN}${path}`;

  return pageDocument({
    title,
    description,
    canonicalUrl,
    image,
    type: "product",
    appMarkup: shell(productMarkup(product, store), path, 0)
  });
}

async function pageDocument({ title, description, canonicalUrl, image, type = "website", appMarkup }) {
  let template = await readFile(join(process.cwd(), "index.html"), "utf8");
  template = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  template = replaceMeta(template, "name", "description", description);
  template = replaceMeta(template, "property", "og:title", title);
  template = replaceMeta(template, "property", "og:description", description);
  template = replaceMeta(template, "property", "og:type", type);
  template = replaceMeta(template, "property", "og:url", canonicalUrl);
  template = replaceMeta(template, "property", "og:image", image);
  template = replaceMeta(template, "property", "og:image:secure_url", image);
  template = replaceMeta(template, "property", "og:image:alt", title);
  template = replaceMeta(template, "name", "twitter:card", "summary_large_image");
  template = replaceMeta(template, "name", "twitter:title", title);
  template = replaceMeta(template, "name", "twitter:description", description);
  template = replaceMeta(template, "name", "twitter:image", image);
  template = template.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`);
  template = template.replace(/<script\s+type="module"\s+src="\/src\/main\.js[^"]*"><\/script>/i, `<script type="module" src="${BUNDLE_URL}"></script>`);
  template = template.replace("<!-- NIXP_APP_MARKER -->", appMarkup);
  return template;
}

function productMarkup(product, store = {}) {
  const images = [...new Set((Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(Boolean))];
  const format = product.displayFormat || product.format || "Product";
  const isRecord = product.category === "Records";
  const isOfferOnly = product.open_to_offers === true;
  const details = isRecord
    ? `<div><dt>Format</dt><dd>${escapeHtml(format)}</dd></div><div><dt>Condition</dt><dd>${escapeHtml(product.condition || "Available")}</dd></div><div><dt>Edition</dt><dd>${escapeHtml(product.edition || "Not specified")}</dd></div><div><dt>Label</dt><dd>${escapeHtml(product.label || "-")}</dd></div><div><dt>Year</dt><dd>${escapeHtml(product.year || "-")}</dd></div>`
    : `<div><dt>Condition</dt><dd>${escapeHtml(product.condition || "Available")}</dd></div>`;
  const review = product.reviewQuote
    ? `<blockquote class="product-review"><p>&quot;${escapeHtml(product.reviewQuote)}&quot;</p><cite>${escapeHtml(product.reviewSource || "Source review")}</cite></blockquote>`
    : "";
  const availableArtists = new Map(
    (store.products || [])
      .filter((item) => item.category === "Records")
      .flatMap((item) => artistCreditNames(item.artist).map((artist) => [artistIdentityKey(artist), artist]))
  );
  const relatedArtists = product.category === "Records" && Array.isArray(product.relatedArtists)
    ? product.relatedArtists.filter(Boolean)
    : [];
  const relatedMarkup = relatedArtists.length
    ? `<p class="related-artist-heading">Related Artists</p><div class="related-artist-tags" aria-label="Related artists">${relatedArtists.map((artist) => {
        const available = artistCreditNames(artist)
          .map((name) => availableArtists.get(artistIdentityKey(name)))
          .find(Boolean);
        return available
          ? `<a href="/artists/${slugify(available)}" data-link data-related-artist-link>${escapeHtml(artist)}</a>`
          : `<span>${escapeHtml(artist)}</span>`;
      }).join("")}</div>`
    : "";
  return `<section class="product-detail"><div class="detail-gallery">${images.map((image, index) => `<figure class="product-art product-art-large"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}${images.length > 1 ? ` image ${index + 1}` : ""}" /></figure>`).join("")}</div><aside class="detail-copy"><a class="back-link" href="/${publicCategoryPath(product)}" data-link>${escapeHtml(product.category)}</a><p class="eyebrow">${escapeHtml(product.artist)}</p><h1>${escapeHtml(product.title)}</h1><div class="detail-price">${isOfferOnly ? "Private Collection / Offer Only" : escapeHtml(formatPrice(product.price))}</div><p class="product-description">${escapeHtml(product.description || "").replaceAll("\n", "<br />")}</p>${review}<div class="detail-actions">${isOfferOnly ? `<a class="button button-dark" href="/make-an-offer?product=${encodeURIComponent(product.id)}" data-link>Make an Offer</a>` : `<button class="button button-dark" type="button" data-add-cart="${escapeHtml(product.id)}">Add to cart</button>`}</div><dl class="detail-list">${details}</dl>${relatedMarkup}</aside></section>`;
}

function normalizePath(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") && !path.includes("..") ? path.replace(/\/+$/, "") : "";
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function absoluteUrl(value) {
  const image = String(value || "").trim();
  return /^https?:\/\//i.test(image) ? image : `${ORIGIN}${image.startsWith("/") ? "" : "/"}${image}`;
}

function formatPrice(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function replaceMeta(html, attribute, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+${attribute}="${escapedName}"\\s+content="[^"]*"\\s*\\/?>`, "i");
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(value)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("Product not found.");
}

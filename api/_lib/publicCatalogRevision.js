import { createHash } from "node:crypto";

const PUBLIC_EDITORIAL_FIELDS = [
  "id", "sku", "title", "artist", "category", "format", "displayFormat", "apparelType",
  "edition", "barcode", "catalogNumber", "condition", "mediaCondition", "sleeveCondition",
  "year", "label", "collection", "color", "material", "image", "images", "imageCredits",
  "tags", "details", "sizes", "description", "descriptionSource", "reviewQuote", "reviewSource",
  "reviewUrl", "relatedArtists", "homeCollections", "homeSlideSort", "open_to_offers",
  "publishStatus", "visibility"
];

export function publicProductFingerprint(product = {}) {
  const payload = {};
  for (const field of PUBLIC_EDITORIAL_FIELDS) payload[field] = product[field] ?? null;
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function publicCatalogFingerprint(products = []) {
  const rows = publicProducts(products)
    .map((product) => [normalizedSku(product.sku), publicProductFingerprint(product)])
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(stableStringify(rows)).digest("hex");
}

export function publicProducts(products = []) {
  return (Array.isArray(products) ? products : []).filter(
    (product) => product?.publishStatus === "Published" && product?.visibility === "Public"
  );
}

export function normalizedSku(value) {
  return String(value || "").trim().toUpperCase();
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

const CATEGORY_PATHS = new Map([
  ["Records", "records"],
  ["Objects", "objects"],
  ["Apparel", "apparel"],
  ["Accessories", "accessories"],
  ["Publishing", "publishing"]
]);

export function slugifyPublic(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function publicCategoryPath(categoryOrProduct) {
  const category = typeof categoryOrProduct === "string" ? categoryOrProduct : categoryOrProduct?.category;
  return CATEGORY_PATHS.get(String(category || "").trim()) || slugifyPublic(category || "catalog");
}

export function publicProductSlug(product = {}) {
  const parts = [product.artist, product.title];
  if (product.category === "Records") parts.push(product.displayFormat || product.format);
  const readable = slugifyPublic(parts.filter(Boolean).join("-"));
  return readable || slugifyPublic(product.sku || product.id) || "product";
}

export function publicProductPath(product = {}) {
  return `/${publicCategoryPath(product)}/${publicProductSlug(product)}`;
}

export function parsePublicProductPath(path) {
  const match = String(path || "").match(/^\/(records|objects|apparel|accessories|publishing)\/([^/]+)$/);
  if (!match) return null;
  return { categoryPath: match[1], slug: decodeURIComponent(match[2]) };
}

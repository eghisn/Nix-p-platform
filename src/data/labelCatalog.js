import { canonicalLabelName } from "./catalogIdentity.js";
import { slugifyPublic } from "./publicUrls.js";
import { verifiedLabelLogos } from "./labelLogoManifest.js";

export function labelParts(value) {
  return [...new Set(
    String(value || "")
      .split(/\s*\/\s*/)
      .map((part) => canonicalLabelName(part))
      .map((part) => part.trim())
      .filter(Boolean)
  )];
}

export function labelSlug(value) {
  return slugifyPublic(canonicalLabelName(value));
}

export function labelLogoPath(value) {
  const slug = labelSlug(value);
  const logo = verifiedLabelLogos[slug];
  return `/label-assets/${logo?.assetSlug || slug}.${logo?.extension || "png"}`;
}

export function labelEntries(products = []) {
  const entries = new Map();
  for (const product of products) {
    if (product?.category !== "Records") continue;
    for (const name of labelParts(product.label)) {
      const slug = labelSlug(name);
      if (!slug) continue;
      const current = entries.get(slug) || { name, slug, productCount: 0 };
      current.productCount += 1;
      entries.set(slug, current);
    }
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function productMatchesLabel(product, slug) {
  const requestedSlug = labelSlug(slug);
  return requestedSlug && labelParts(product?.label).some((name) => labelSlug(name) === requestedSlug);
}

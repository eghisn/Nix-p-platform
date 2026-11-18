const LEGACY_NIX_POWELL = new Set(["NXP-2026-APP-0002", "NXP-2023-APP-0001"]);
const LEGACY_MUSIC_MERCH = new Set(["NXP-2026-APP-0011", "NXP-2026-APP-0012"]);

export function apparelCollection(product = {}) {
  const sku = String(product.sku || "").trim().toUpperCase();
  if (LEGACY_MUSIC_MERCH.has(sku)) return "Music Merch";
  if (LEGACY_NIX_POWELL.has(sku)) return "Nix Powell";
  const values = [product.label, product.collection, ...(Array.isArray(product.tags) ? product.tags : [])]
    .map((value) => String(value || "").trim().toLowerCase());
  if (values.some((value) => ["nix powell", "nixp apparel"].includes(value))) return "Nix Powell";
  if (values.includes("music merch")) return "Music Merch";
  return "";
}

const ARTIST_CREDIT_ALIASES = new Map([
  ["amnesia scanner & bill kouligas", ["Amnesia Scanner", "Bill Kouligas"]],
  ["ford & lopatin", ["Ford", "Daniel Lopatin"]],
  ["heith & tarawangsawelas", ["Heith", "Tarawangsawelas"]],
  ["senyawa, kazuhisa uchihashi", ["Senyawa", "Kazuhisa Uchihashi"]],
  ["overmono & the streets turn the page", ["Overmono", "The Streets"]],
  ["jk flesh, gothtrad", ["JK Flesh", "Gothtrad"]],
  ["jk flesh & gothtrad", ["JK Flesh", "Gothtrad"]],
  // Siouxsie and the Banshees is a single artist name, not a collaboration.
  // Keep common ampersand/spelling variants on the same artist page.
  ["siouxsie & the banshees", ["Siouxsie And The Banshees"]],
  ["siouxsie and the banshees", ["Siouxsie And The Banshees"]],
  ["siouxie & the banshees", ["Siouxsie And The Banshees"]],
  ["siouxie and the banshees", ["Siouxsie And The Banshees"]],
  ["soft moon", ["The Soft Moon"]],
  ["boards of canada", ["Boards of Canada"]]
]);

const ARTIST_CANONICAL_NAMES = new Map([
  ["prodigy", "The Prodigy"],
  ["the prodigy", "The Prodigy"],
  ["soft moon", "The Soft Moon"],
  ["the soft moon", "The Soft Moon"],
  ["siouxsie & the banshees", "Siouxsie And The Banshees"],
  ["siouxsie and the banshees", "Siouxsie And The Banshees"],
  ["siouxie & the banshees", "Siouxsie And The Banshees"],
  ["siouxie and the banshees", "Siouxsie And The Banshees"],
  ["boards of canada", "Boards of Canada"],
  ["v.a.", "Various Artists"],
  ["va", "Various Artists"]
]);

// Some compilation records are stored in Finance under the contributing
// artists printed on the release, while the storefront credits the release
// as Various Artists. Keep this correction keyed to the stable SKU so a
// generic collaboration split never changes unrelated products.
const PRODUCT_ARTIST_OVERRIDES = new Map([
  ["NXP-2026-VNL-0050", "Various Artists"]
]);

// Exact credits are kept above because not every ampersand is a collaboration.
// For new collaborative release credits, the separator rule below creates
// individual artist pages without changing the release's printed credit.
const COLLABORATION_SEPARATOR = /\s+(?:&|and|with|feat\.?|featuring)\s+|\s*,\s*/i;

export function canonicalArtistName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  return ARTIST_CANONICAL_NAMES.get(name.toLowerCase()) || name;
}

export function canonicalProductArtist(product = {}) {
  const sku = String(product.sku || "").trim().toUpperCase();
  return PRODUCT_ARTIST_OVERRIDES.get(sku) || canonicalArtistName(product.artist);
}

export function artistCreditNames(value) {
  const name = String(value || "").trim();
  if (!name) return [];
  const exact = ARTIST_CREDIT_ALIASES.get(name.toLowerCase());
  if (exact) return [...exact];
  const credits = name
    .split(COLLABORATION_SEPARATOR)
    .map((credit) => canonicalArtistName(credit))
    .filter(Boolean);
  return credits.length > 1 ? [...new Set(credits)] : [canonicalArtistName(name)];
}

export function canonicalRelatedArtistName(value) {
  return canonicalArtistName(value);
}

export function canonicalLabelName(value) {
  const label = String(value || "").trim();
  const lower = label.toLowerCase();
  if (!label) return "";
  if (lower === "epitaph" || lower === "epitaph europe" || lower === "epitaph records") return "Epitaph";
  if (
    lower === "warner bros" ||
    lower === "warner bros." ||
    lower === "warner bros records" ||
    lower === "warner bros. records"
  ) return "Warner Bros.";
  if (lower.includes("rough trade")) return "Rough Trade";
  if (lower.includes("jagjaguwar")) return "Jagjaguwar";
  if (lower.includes("warp")) return "Warp Records";
  if (lower === "p2") return "Dense(s) Records";
  return label;
}

export function artistIdentityKey(value) {
  return canonicalArtistName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

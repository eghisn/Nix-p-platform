const ARTIST_CREDIT_ALIASES = new Map([
  ["amnesia scanner & bill kouligas", ["Amnesia Scanner", "Bill Kouligas"]],
  ["heith & tarawangsawelas", ["Heith", "Tarawangsawelas"]],
  ["senyawa, kazuhisa uchihashi", ["Senyawa", "Kazuhisa Uchihashi"]],
  ["overmono & the streets turn the page", ["Overmono", "The Streets"]],
  ["soft moon", ["The Soft Moon"]],
  ["boards of canada", ["Boards of Canada"]]
]);

const ARTIST_CANONICAL_NAMES = new Map([
  ["soft moon", "The Soft Moon"],
  ["the soft moon", "The Soft Moon"],
  ["boards of canada", "Boards of Canada"]
]);

export function canonicalArtistName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  return ARTIST_CANONICAL_NAMES.get(name.toLowerCase()) || name;
}

export function artistCreditNames(value) {
  const name = String(value || "").trim();
  if (!name) return [];
  const exact = ARTIST_CREDIT_ALIASES.get(name.toLowerCase());
  if (exact) return [...exact];
  return [canonicalArtistName(name)];
}

export function canonicalRelatedArtistName(value) {
  return canonicalArtistName(value);
}

export function canonicalLabelName(value) {
  const label = String(value || "").trim();
  const lower = label.toLowerCase();
  if (!label) return "";
  if (lower.includes("rough trade")) return "Rough Trade";
  if (lower.includes("jagjaguwar")) return "Jagjaguwar";
  if (lower.includes("warp")) return "Warp Records";
  return label;
}

export function artistIdentityKey(value) {
  return canonicalArtistName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

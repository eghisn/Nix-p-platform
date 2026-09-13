export const VINYL_SIZES = ["", "12", "10", "7"];

// Legacy rows are listed only when their existing Edition already names the
// size. This is a migration aid, not a research or inference rule.
export const LEGACY_VINYL_SIZE_BY_SKU = Object.freeze({
  "NXP-2026-VNL-0082": "12", "NXP-2026-VNL-0071": "12", "NXP-2026-VNL-0070": "12",
  "NXP-2026-VNL-0068": "12", "NXP-2026-VNL-0067": "12", "NXP-2026-VNL-0018": "12",
  "NXP-2026-VNL-0065": "12", "NXP-2026-VNL-0064": "12", "NXP-2026-VNL-0062": "12",
  "NXP-2026-VNL-0060": "12", "NXP-2026-VNL-0059": "12", "NXP-2026-VNL-0058": "12",
  "NXP-2026-VNL-0057": "12", "NXP-2026-VNL-0051": "12", "NXP-2026-VNL-0050": "12",
  "NXP-2026-VNL-0043": "12", "NXP-2026-VNL-0041": "12", "NXP-2026-VNL-0038": "12",
  "NXP-2026-VNL-0037": "12", "NXP-2026-VNL-0010": "12", "NXP-2026-VNL-0005": "12",
  "NXP-2026-VNL-0047": "7", "NXP-2026-VNL-0036": "7", "NXP-2026-VNL-0016": "7"
});

export function normalizeVinylSize(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^vinyl\s*/i, "")
    .replace(/[\"\u2033]/g, "")
    .replace(/\s*(?:inch|in)\.?$/i, "")
    .trim();
  return VINYL_SIZES.includes(normalized) ? normalized : "";
}

export function isVinylRecord(product = {}) {
  return String(product.category || "").trim() === "Records" && String(product.format || "").trim().toLowerCase() === "vinyl";
}

export function recordDisplayFormat(product = {}) {
  const vinylSize = normalizeVinylSize(product.vinylSize || product.raw?.vinylSize);
  return isVinylRecord(product) && vinylSize
    ? `Vinyl ${vinylSize}\"`
    : product.displayFormat || product.format || "Product";
}

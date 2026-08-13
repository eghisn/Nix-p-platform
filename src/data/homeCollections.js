const RECENT_RELEASE_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);

function firstValue(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function dateValue(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function numericSku(product = {}) {
  const match = String(product.sku || product.id || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function isRecentReleaseProduct(product = {}) {
  return (
    product.category === "Records" &&
    RECENT_RELEASE_FORMATS.has(String(product.format || "").trim()) &&
    [2025, 2026].includes(Number(product.year || product.raw?.year || 0))
  );
}

export function recentReleaseSortComparator(a = {}, b = {}) {
  const yearA = Number(a.year || a.raw?.year || 0);
  const yearB = Number(b.year || b.raw?.year || 0);
  if (yearA !== yearB) return yearB - yearA;

  const releaseDateA = dateValue(firstValue(a.releaseDate, a.release_date, a.raw?.releaseDate, a.raw?.release_date));
  const releaseDateB = dateValue(firstValue(b.releaseDate, b.release_date, b.raw?.releaseDate, b.raw?.release_date));
  if (releaseDateA !== releaseDateB) return releaseDateB - releaseDateA;

  // For the same release year, the newest saved sync is the stable fallback
  // for a newly added catalogue item when no exact release date is available.
  const syncedA = dateValue(firstValue(a.updatedAt, a.updated_at, a.raw?.updatedAt, a.raw?.updated_at));
  const syncedB = dateValue(firstValue(b.updatedAt, b.updated_at, b.raw?.updatedAt, b.raw?.updated_at));
  if (syncedA !== syncedB) return syncedB - syncedA;

  const skuDifference = numericSku(b) - numericSku(a);
  if (skuDifference) return skuDifference;
  return `${a.artist || ""} ${a.title || ""}`.localeCompare(`${b.artist || ""} ${b.title || ""}`);
}

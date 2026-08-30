import {
  normalizedSku,
  publicCatalogFingerprint,
  publicProductFingerprint,
  publicProducts
} from "./publicCatalogRevision.js";

export async function fetchPublicCatalogRevision() {
  const base = String(process.env.NIXP_PUBLIC_SITE_URL || "https://www.nix-p.com").replace(/\/$/, "");
  const response = await fetch(`${base}/api/catalog?v=${Date.now()}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`Public catalog returned HTTP ${response.status}.`);
  const payload = await response.json();
  return payload?.store?.products || payload?.products || [];
}

export function comparePublicCatalogRevision(expectedProducts = [], liveProducts = [], requestedSkus = []) {
  const requested = new Set((requestedSkus || []).map(normalizedSku).filter(Boolean));
  const expectedPublic = publicProducts(expectedProducts);
  const livePublic = publicProducts(liveProducts);
  const expectedBySku = new Map(expectedPublic.map((product) => [normalizedSku(product.sku), product]));
  const liveBySku = new Map(livePublic.map((product) => [normalizedSku(product.sku), product]));
  const targets = requested.size ? requested : new Set([...expectedBySku.keys(), ...liveBySku.keys()]);
  const mismatches = [];

  for (const sku of targets) {
    const expected = expectedBySku.get(sku);
    const live = liveBySku.get(sku);
    if (!expected && live) {
      mismatches.push({ sku, reason: "still-public" });
    } else if (expected && !live) {
      mismatches.push({ sku, reason: "missing-public-product" });
    } else if (expected && publicProductFingerprint(expected) !== publicProductFingerprint(live)) {
      mismatches.push({ sku, reason: "content-mismatch" });
    }
  }

  return {
    confirmed: mismatches.length === 0,
    mismatches,
    expectedFingerprint: requested.size ? null : publicCatalogFingerprint(expectedPublic),
    liveFingerprint: requested.size ? null : publicCatalogFingerprint(livePublic)
  };
}

// A GitHub commit is not proof that visitors can see it. This verifier checks
// every visitor-facing editorial field and verifies unpublished SKUs are gone.
export async function verifyPublicCatalogRevision(products = [], requestedSkus = []) {
  const targetSkus = new Set((requestedSkus.length ? requestedSkus : products.map((product) => product.sku))
    .map(normalizedSku)
    .filter(Boolean));
  if (!targetSkus.size) return { confirmed: true, checkedAt: new Date().toISOString(), attempts: 0 };
  const deadline = Date.now() + 30000;
  let attempts = 0;
  let lastComparison = null;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const liveProducts = await fetchPublicCatalogRevision();
      lastComparison = comparePublicCatalogRevision(products, liveProducts, requestedSkus);
      if (lastComparison.confirmed) {
        return { ...lastComparison, checkedAt: new Date().toISOString(), attempts };
      }
    } catch {
      // A new Vercel revision can briefly be unavailable while building.
    }
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  return {
    ...(lastComparison || {}),
    confirmed: false,
    checkedAt: new Date().toISOString(),
    attempts,
    reason: "Vercel deployment has not exposed the exact committed catalog revision yet."
  };
}

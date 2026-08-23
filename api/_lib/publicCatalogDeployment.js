// A GitHub commit is not proof that visitors can see it. This verifier polls
// the public catalog snapshot and is shared by all Admin publication paths.
export async function verifyPublicCatalogRevision(products = [], requestedSkus = []) {
  const targetSkus = new Set((requestedSkus.length ? requestedSkus : products.map((product) => product.sku))
    .map((sku) => String(sku || "").trim().toUpperCase())
    .filter(Boolean));
  if (!targetSkus.size) return { confirmed: true, checkedAt: new Date().toISOString(), attempts: 0 };
  const expected = (products || []).filter((product) => targetSkus.has(String(product.sku || "").trim().toUpperCase()));
  const base = String(process.env.NIXP_PUBLIC_SITE_URL || "https://www.nix-p.com").replace(/\/$/, "");
  const deadline = Date.now() + 30000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const response = await fetch(`${base}/api/catalog?v=${Date.now()}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000)
      });
      const payload = response.ok ? await response.json() : null;
      const publicBySku = new Map((payload?.store?.products || payload?.products || [])
        .map((product) => [String(product.sku || "").trim().toUpperCase(), product]));
      const confirmed = expected.every((product) => {
        const live = publicBySku.get(String(product.sku || "").trim().toUpperCase());
        return live && live.publishStatus === "Published" && live.visibility === "Public" &&
          String(live.title || "") === String(product.title || "") &&
          String(live.artist || "") === String(product.artist || "");
      });
      if (confirmed) return { confirmed: true, checkedAt: new Date().toISOString(), attempts };
    } catch {
      // A new Vercel revision can briefly be unavailable while building.
    }
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  return { confirmed: false, checkedAt: new Date().toISOString(), attempts, reason: "Vercel deployment has not exposed the committed catalog revision yet." };
}

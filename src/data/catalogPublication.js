const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);

export function isFinanceCatalogProduct(product = {}) {
  return Boolean(
    String(product.id || "").startsWith("finance-") ||
      product.financeStockId ||
      product.raw?.financeStockId ||
      product.enrichmentStatus ||
      product.raw?.enrichmentStatus
  );
}

export function recordPublicationIssues(product = {}) {
  const raw = product.raw || {};
  const category = normalizedCategory(product);
  const format = String(product.format || raw.format || "");
  if (category !== "records" || !RECORD_FORMATS.has(format)) return [];

  const image = String(product.image || raw.image || "").trim();
  const openToOffers = product.open_to_offers === true || raw.open_to_offers === true;
  const price = Number(product.price ?? raw.price ?? 0);
  const minimumOffer = Number(product.minimumAcceptableOffer ?? product.minimum_acceptable_offer ?? raw.minimumAcceptableOffer ?? 0);
  const fields = [
    ["title", product.title || raw.title],
    ["artist", product.artist || raw.artist],
    ["label", product.label || raw.label],
    ["description", product.description || raw.description]
  ];
  const issues = fields.filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (!Number(product.year || raw.year || 0)) issues.push("release year");
  if (!isManagedProductImage(image)) issues.push("managed cover art");
  if (openToOffers ? minimumOffer <= 0 : price <= 0) issues.push(openToOffers ? "minimum acceptable offer" : "selling price");
  return issues;
}

export function apparelPublicationIssues(product = {}) {
  const raw = product.raw || {};
  const category = normalizedCategory(product);
  if (category !== "apparel") return [];

  const image = String(product.image || raw.image || "").trim();
  const openToOffers = product.open_to_offers === true || raw.open_to_offers === true;
  const price = Number(product.price ?? raw.price ?? 0);
  const minimumOffer = Number(product.minimumAcceptableOffer ?? product.minimum_acceptable_offer ?? raw.minimumAcceptableOffer ?? 0);
  const issues = [];
  if (!String(product.title || raw.title || "").trim()) issues.push("title");
  if (!image || image.includes("nixp-product-example")) issues.push("managed product photo");
  if (openToOffers ? minimumOffer <= 0 : price <= 0) issues.push(openToOffers ? "minimum acceptable offer" : "selling price");
  return issues;
}

export function catalogPublicationIssues(product = {}) {
  const category = normalizedCategory(product);
  if (category === "records") return recordPublicationIssues(product);
  if (category === "apparel") return apparelPublicationIssues(product);
  return [];
}

export function isRecordPublicationReady(product = {}) {
  return (
    (product.raw?.publishAfterResearch === true && isResearchPublicationReady(product)) ||
    recordPublicationIssues(product).length === 0
  );
}

export function isCatalogPublicationReady(product = {}) {
  const category = normalizedCategory(product);
  if (category === "records") return isRecordPublicationReady(product);
  if (category === "apparel") return apparelPublicationIssues(product).length === 0;
  return true;
}

export function isResearchPublicationReady(product = {}) {
  const raw = product.raw || {};
  const category = normalizedCategory(product);
  const format = String(product.format || raw.format || "");
  if (category !== "records" || !RECORD_FORMATS.has(format)) return false;
  const title = String(product.title || raw.title || "").trim();
  const artist = String(product.artist || raw.artist || "").trim();
  const condition = String(product.condition || raw.condition || "").trim();
  const image = String(product.image || raw.image || "").trim();
  const description = String(product.description || raw.description || "").trim();
  const label = String(product.label || raw.label || "").trim();
  const enrichmentStatus = String(product.enrichmentStatus || raw.enrichmentStatus || "").trim();
  const openToOffers = product.open_to_offers === true || raw.open_to_offers === true;
  const price = Number(product.price ?? raw.price ?? 0);
  const minimumOffer = Number(product.minimumAcceptableOffer ?? product.minimum_acceptable_offer ?? raw.minimumAcceptableOffer ?? 0);
  return Boolean(
    title &&
      artist &&
      condition &&
      label &&
      description &&
      isManagedProductImage(image) &&
      ["complete", "complete-no-related-artists"].includes(enrichmentStatus) &&
      (openToOffers ? minimumOffer > 0 : price > 0)
  );
}

export function applyCatalogPublicationSafety(store = {}) {
  return {
    ...store,
    products: (store.products || []).map((product) => {
      if (!isFinanceCatalogProduct(product) || isCatalogPublicationReady(product)) {
        const category = normalizedCategory(product);
        if (category === "records" || !product.raw?.publicationIssues) return product;
        const { publicationIssues: _staleIssues, ...cleanRaw } = product.raw || {};
        return { ...product, raw: cleanRaw };
      }
      const issues = catalogPublicationIssues(product);
      return {
        ...product,
        publishStatus: "Draft",
        visibility: "Private",
        raw: {
          ...(product.raw || {}),
          publishStatus: "Draft",
          visibility: "Private",
          publicationIssues: issues
        }
      };
    })
  };
}

function normalizedCategory(product = {}) {
  return String(product.category || product.raw?.category || "").trim().toLowerCase();
}

function arrayValue(primary, fallback) {
  if (Array.isArray(primary)) return primary.filter(Boolean);
  if (Array.isArray(fallback)) return fallback.filter(Boolean);
  return [];
}

function isManagedProductImage(value) {
  const image = String(value || "").trim();
  return Boolean(
    image &&
      !image.includes("nixp-product-example") &&
      (image.startsWith("/public/") ||
        image.startsWith("/assets/") ||
        /supabase\.co\/storage\/v1\/object\/public\//i.test(image))
  );
}

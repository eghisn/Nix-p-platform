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
  const category = String(product.category || raw.category || "");
  const format = String(product.format || raw.format || "");
  if (category !== "Records" || !RECORD_FORMATS.has(format)) return [];

  const relatedArtists = arrayValue(product.relatedArtists, raw.relatedArtists);
  const image = String(product.image || raw.image || "").trim();
  const openToOffers = product.open_to_offers === true || raw.open_to_offers === true;
  const price = Number(product.price ?? raw.price ?? 0);
  const minimumOffer = Number(product.minimumAcceptableOffer ?? product.minimum_acceptable_offer ?? raw.minimumAcceptableOffer ?? 0);
  const fields = [
    ["title", product.title || raw.title],
    ["artist", product.artist || raw.artist],
    ["label", product.label || raw.label],
    ["description", product.description || raw.description],
    ["description source", product.descriptionSource || raw.descriptionSource],
    ["review", product.reviewQuote || raw.reviewQuote],
    ["review source", product.reviewSource || raw.reviewSource]
  ];
  const issues = fields.filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (!Number(product.year || raw.year || 0)) issues.push("release year");
  if (!image || image.includes("nixp-product-example")) issues.push("managed cover art");
  if (!relatedArtists.length) issues.push("related artists available in inventory");
  if (openToOffers ? minimumOffer <= 0 : price <= 0) issues.push(openToOffers ? "minimum acceptable offer" : "selling price");
  return issues;
}

export function isRecordPublicationReady(product = {}) {
  return recordPublicationIssues(product).length === 0;
}

export function applyCatalogPublicationSafety(store = {}) {
  return {
    ...store,
    products: (store.products || []).map((product) => {
      if (!isFinanceCatalogProduct(product) || isRecordPublicationReady(product)) return product;
      return {
        ...product,
        publishStatus: "Draft",
        visibility: "Private",
        raw: {
          ...(product.raw || {}),
          publishStatus: "Draft",
          visibility: "Private",
          publicationIssues: recordPublicationIssues(product)
        }
      };
    })
  };
}

function arrayValue(primary, fallback) {
  if (Array.isArray(primary)) return primary.filter(Boolean);
  if (Array.isArray(fallback)) return fallback.filter(Boolean);
  return [];
}

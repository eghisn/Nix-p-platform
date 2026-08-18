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
    ["description", product.description || raw.description]
  ];
  const issues = fields.filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  const reviewQuote = String(product.reviewQuote || raw.reviewQuote || "").trim();
  const reviewSource = String(product.reviewSource || raw.reviewSource || "").trim();
  if (!reviewQuote || !reviewSource) issues.push("source-backed review");
  if (!Number(product.year || raw.year || 0)) issues.push("release year");
  if (!image || image.includes("nixp-product-example")) issues.push("managed cover art");
  const relatedResearchStatus = String(product.relatedArtistsResearch?.status || raw.relatedArtistsResearch?.status || "").trim();
  if (!relatedArtists.length && !["verified", "combined", "lastfm", "no-verified-match"].includes(relatedResearchStatus)) {
    issues.push("verified related-artist research");
  }
  if (openToOffers ? minimumOffer <= 0 : price <= 0) issues.push(openToOffers ? "minimum acceptable offer" : "selling price");
  return issues;
}

export function isRecordPublicationReady(product = {}) {
  return (
    (product.raw?.publishAfterResearch === true && isResearchPublicationReady(product)) ||
    recordPublicationIssues(product).length === 0
  );
}

export function isResearchPublicationReady(product = {}) {
  const raw = product.raw || {};
  const category = String(product.category || raw.category || "");
  const format = String(product.format || raw.format || "");
  if (category !== "Records" || !RECORD_FORMATS.has(format)) return false;
  const title = String(product.title || raw.title || "").trim();
  const artist = String(product.artist || raw.artist || "").trim();
  const condition = String(product.condition || raw.condition || "").trim();
  const image = String(product.image || raw.image || "").trim();
  const description = String(product.description || raw.description || "").trim();
  const label = String(product.label || raw.label || "").trim();
  const reviewQuote = String(product.reviewQuote || raw.reviewQuote || "").trim();
  const reviewSource = String(product.reviewSource || raw.reviewSource || "").trim();
  const relatedResearchStatus = String(product.relatedArtistsResearch?.status || raw.relatedArtistsResearch?.status || "").trim();
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
      reviewQuote &&
      reviewSource &&
      image &&
      !image.includes("nixp-product-example") &&
      ["complete", "complete-no-related-artists"].includes(enrichmentStatus) &&
      (["verified", "combined", "lastfm", "no-verified-match"].includes(relatedResearchStatus) || Boolean(product.relatedArtists?.length || raw.relatedArtists?.length)) &&
      (openToOffers ? minimumOffer > 0 : price > 0)
  );
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

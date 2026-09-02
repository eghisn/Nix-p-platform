const PROFILE_SOURCE = "NIXP packaging rules v1";

export function referenceShippingProfile(product = {}, existing = {}) {
  const current = existing && typeof existing === "object" ? existing : {};
  if (current.manualShippingOverride === true) return current;
  if (hasCompleteShippingProfile(current) && current.status !== "needs_measurement") return current;

  const format = String(product.format || product.display_format || product.displayFormat || "").trim().toLowerCase();
  const edition = [product.edition, product.raw?.edition, product.details].flat().filter(Boolean).join(" ").toLowerCase();
  const productText = normalizedText(
    product.category,
    product.apparelType,
    product.apparel_type,
    product.format,
    product.display_format,
    product.displayFormat,
    product.title,
    product.material,
    product.details,
    current.shippingClass
  );
  const updatedAt = new Date().toISOString().slice(0, 10);

  if (format === "vinyl") {
    const heavy = /\b2\s*x\s*lp\b|\b3\s*x\s*lp\b|double lp|triple lp|heavy vinyl|180\s*g/.test(edition);
    return mergeProfile(current, profile({
      weightGrams: heavy ? 750 : 550,
      lengthCm: 34,
      widthCm: 34,
      heightCm: 4,
      shippingClass: "vinyl-cardboard-bubble",
      packageType: "bubble-wrap-corrugated-vinyl-mailer",
      packagingGroup: "VINYL",
      vinylWeightClass: heavy ? "heavy" : "standard",
      updatedAt
    }));
  }

  if (format === "cd") {
    return mergeProfile(current, profile({
      weightGrams: 120,
      lengthCm: 18,
      widthCm: 16,
      heightCm: 6,
      shippingClass: "small-media-cd-bubble",
      packageType: "bubble-wrap-corrugated-small-media",
      packagingGroup: "SMALL_MEDIA",
      updatedAt
    }));
  }

  if (format === "cassette") {
    return mergeProfile(current, profile({
      weightGrams: 90,
      lengthCm: 16,
      widthCm: 12,
      heightCm: 8,
      shippingClass: "small-media-cassette-bubble",
      packageType: "bubble-wrap-corrugated-small-media",
      packagingGroup: "SMALL_MEDIA",
      updatedAt
    }));
  }

  if (isRing(productText)) {
    return mergeProfile(current, profile({
      weightGrams: 100,
      lengthCm: 10,
      widthCm: 8,
      heightCm: 7,
      shippingClass: "ring-hardbox",
      packageType: "ring-hardbox-10x8x7",
      packagingGroup: "RING_HARDBOX",
      updatedAt
    }));
  }

  if (isCap(productText)) {
    return mergeProfile(current, profile({
      weightGrams: 180,
      lengthCm: 20,
      widthCm: 20,
      heightCm: 8,
      shippingClass: "apparel-cap-hardbox",
      packageType: "cap-hardbox-20x20x8",
      packagingGroup: "CAP_HARDBOX",
      updatedAt
    }));
  }

  const apparelKind = softApparelKind(productText);
  if (apparelKind) {
    const dimensions = apparelKind === "hoodie"
      ? { weightGrams: 900, lengthCm: 40, widthCm: 32, heightCm: 9 }
      : apparelKind === "crewneck"
        ? { weightGrams: 800, lengthCm: 40, widthCm: 32, heightCm: 7 }
        : apparelKind === "longsleeve"
          ? { weightGrams: 360, lengthCm: 36, widthCm: 28, heightCm: 4 }
          : { weightGrams: 280, lengthCm: 36, widthCm: 28, heightCm: 3 };
    return mergeProfile(current, profile({
      ...dimensions,
      shippingClass: "apparel-soft-zip-lock-wrap",
      packageType: "zip-lock-polybag-shipping-wrap",
      packagingGroup: "SOFT_APPAREL",
      updatedAt
    }));
  }

  if (/\bapparel\b/.test(productText)) {
    return {
      ...current,
      manualShippingOverride: false,
      status: "needs_measurement",
      source: "NIXP packaging rules v1: select a supported apparel type or enter measured dimensions",
      updatedAt
    };
  }

  return current;
}

function normalizedText(...values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRing(text) {
  return /\bring\b/.test(text);
}

function isCap(text) {
  return /\bcap\b|\bhat\b/.test(text);
}

function softApparelKind(text) {
  if (/\bhoodie\b/.test(text)) return "hoodie";
  if (/\bcrewneck\b|\bknit\b|\bsweatshirt\b|\bsweater\b/.test(text)) return "crewneck";
  if (/\blongsleeve\b|\blong sleeve\b/.test(text)) return "longsleeve";
  if (/\bt shirt\b|\btshirt\b|\btee\b/.test(text)) return "tshirt";
  return "";
}

function mergeProfile(current, generated) {
  const numericFields = ["weightGrams", "lengthCm", "widthCm", "heightCm"];
  const merged = { ...generated };
  for (const field of numericFields) {
    if (Number(current[field]) > 0) merged[field] = Number(current[field]);
  }
  for (const field of ["shippingClass", "packageType", "packagingGroup", "vinylWeightClass"]) {
    if (String(current[field] || "").trim()) merged[field] = current[field];
  }
  return merged;
}

export function hasCompleteShippingProfile(shipping = {}) {
  return Boolean(
    Number(shipping.weightGrams) > 0 &&
      Number(shipping.lengthCm) > 0 &&
      Number(shipping.widthCm) > 0 &&
      Number(shipping.heightCm) > 0 &&
      String(shipping.packagingGroup || "").trim()
  );
}

function profile(values) {
  return {
    ...values,
    manualShippingOverride: false,
    status: "format_reference",
    source: PROFILE_SOURCE
  };
}

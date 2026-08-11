const PROFILE_SOURCE = "NIXP packaging rules v1";

export function referenceShippingProfile(product = {}, existing = {}) {
  const current = existing && typeof existing === "object" ? existing : {};
  if (current.manualShippingOverride === true) return current;
  if (hasCompleteShippingProfile(current) && current.status !== "needs_measurement") return current;

  const format = String(product.format || product.display_format || product.displayFormat || "").trim().toLowerCase();
  const edition = [product.edition, product.raw?.edition, product.details].flat().filter(Boolean).join(" ").toLowerCase();
  const updatedAt = new Date().toISOString().slice(0, 10);

  if (format === "vinyl") {
    const heavy = /\b2\s*x\s*lp\b|\b3\s*x\s*lp\b|double lp|triple lp|heavy vinyl|180\s*g/.test(edition);
    return profile({
      weightGrams: heavy ? 750 : 550,
      lengthCm: 34,
      widthCm: 34,
      heightCm: 4,
      shippingClass: "vinyl-cardboard-bubble",
      packageType: "bubble-wrap-corrugated-vinyl-mailer",
      packagingGroup: "VINYL",
      vinylWeightClass: heavy ? "heavy" : "standard",
      updatedAt
    });
  }

  if (format === "cd") {
    return profile({
      weightGrams: 120,
      lengthCm: 18,
      widthCm: 16,
      heightCm: 6,
      shippingClass: "small-media-cd-bubble",
      packageType: "bubble-wrap-corrugated-small-media",
      packagingGroup: "SMALL_MEDIA",
      updatedAt
    });
  }

  if (format === "cassette") {
    return profile({
      weightGrams: 90,
      lengthCm: 16,
      widthCm: 12,
      heightCm: 8,
      shippingClass: "small-media-cassette-bubble",
      packageType: "bubble-wrap-corrugated-small-media",
      packagingGroup: "SMALL_MEDIA",
      updatedAt
    });
  }

  return current;
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

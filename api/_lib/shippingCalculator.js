export const SHIPPING_CALCULATOR_VERSION = "nixp-rule-v1";
export const DEFAULT_VOLUMETRIC_DIVISOR = 6000;

const VINYL_DIMENSIONS = {
  1: { lengthCm: 34, widthCm: 34, heightCm: 4 },
  2: { lengthCm: 34, widthCm: 34, heightCm: 6 },
  3: { lengthCm: 34, widthCm: 34, heightCm: 8 }
};

const APPAREL_DIMENSIONS = {
  1: { lengthCm: 30, widthCm: 25, heightCm: 6 },
  2: { lengthCm: 35, widthCm: 28, heightCm: 10 },
  3: { lengthCm: 38, widthCm: 30, heightCm: 14 },
  4: { lengthCm: 40, widthCm: 32, heightCm: 18 }
};

const CAP_RULES = {
  1: { ruleWeightKg: 2, lengthCm: 25, widthCm: 22, heightCm: 14 },
  2: { ruleWeightKg: 3, lengthCm: 30, widthCm: 25, heightCm: 18 },
  3: { ruleWeightKg: 4, lengthCm: 35, widthCm: 30, heightCm: 20 }
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedText(...values) {
  return values.filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shippingData(product = {}) {
  return product.shipping || product.raw?.shipping || {};
}

function explicitGroup(product) {
  const value = String(shippingData(product).packagingGroup || "").trim().toUpperCase();
  return ["VINYL", "SMALL_MEDIA", "SOFT_APPAREL", "CAP_HARDBOX", "RING_HARDBOX"].includes(value) ? value : "";
}

function hasManualOverride(product) {
  const value = shippingData(product).manualShippingOverride;
  return value === true || ["yes", "true", "1"].includes(String(value || "").toLowerCase());
}

function classifyUnit(product) {
  const shipping = shippingData(product);
  if (hasManualOverride(product)) return { group: explicitGroup(product) || "MANUAL_OVERRIDE", kind: "manual" };
  const explicit = explicitGroup(product);
  const text = normalizedText(product.category, product.format, product.display_format, product.displayFormat, product.apparel_type, product.apparelType, product.title, shipping.shippingClass);
  if (explicit) return { group: explicit, kind: inferKind(explicit, text) };
  if (/\bvinyl\b|\blp\b/.test(text)) return { group: "VINYL", kind: "vinyl" };
  if (/\bcd\b|compact disc/.test(text)) return { group: "SMALL_MEDIA", kind: "cd" };
  if (/cassette|\btape\b/.test(text)) return { group: "SMALL_MEDIA", kind: "cassette" };
  if (/\bcap\b|\bhat\b/.test(text)) return { group: "CAP_HARDBOX", kind: "cap" };
  if (/\bring\b/.test(text)) return { group: "RING_HARDBOX", kind: "ring" };
  if (/hoodie/.test(text)) return { group: "SOFT_APPAREL", kind: "hoodie" };
  if (/crewneck|sweater|sweatshirt|knit/.test(text)) return { group: "SOFT_APPAREL", kind: "crewneck" };
  if (/t shirt|tee|longsleeve|apparel/.test(text)) return { group: "SOFT_APPAREL", kind: "tshirt" };
  if (completeManualMeasurements(shipping)) return { group: "MANUAL_OVERRIDE", kind: "manual" };
  throw new Error(`SHIPPING_PROFILE_REQUIRED: ${product.sku || product.id || product.title || "unknown item"}`);
}

function inferKind(group, text) {
  if (group === "VINYL") return "vinyl";
  if (group === "SMALL_MEDIA") return /cassette|tape/.test(text) ? "cassette" : "cd";
  if (group === "CAP_HARDBOX") return "cap";
  if (group === "RING_HARDBOX") return "ring";
  if (group === "SOFT_APPAREL") {
    if (/hoodie/.test(text)) return "hoodie";
    if (/crewneck|sweater|sweatshirt|knit/.test(text)) return "crewneck";
    return "tshirt";
  }
  return "manual";
}

function completeManualMeasurements(shipping) {
  return [shipping.weightGrams, shipping.lengthCm, shipping.widthCm, shipping.heightCm].every((value) => number(value) > 0);
}

function isHeavyVinyl(product) {
  const shipping = shippingData(product);
  const explicit = String(shipping.vinylWeightClass || "").toLowerCase();
  if (explicit === "heavy") return true;
  if (explicit === "standard") return false;
  const text = normalizedText(product.edition, product.displayFormat, product.details, shipping.shippingClass, shipping.packageType);
  return number(shipping.weightGrams) >= 700 || /\b2 ?x ?lp\b|\b3 ?x ?lp\b|double lp|triple lp|heavy vinyl/.test(text);
}

function cartUnits(lines) {
  const units = [];
  for (const line of lines || []) {
    const product = line.product || line;
    const quantity = Math.max(0, Math.min(100, Math.floor(number(line.quantity, 1))));
    const classification = classifyUnit(product);
    for (let index = 0; index < quantity; index += 1) {
      units.push({
        productId: product.id,
        sku: product.sku || product.id,
        title: product.title || "Item",
        size: line.size || "",
        ...classification,
        product
      });
    }
  }
  return units;
}

function itemSummary(units) {
  const grouped = new Map();
  for (const unit of units) {
    const key = `${unit.productId || unit.sku}::${unit.size || ""}`;
    const current = grouped.get(key) || { productId: unit.productId, sku: unit.sku, title: unit.title, size: unit.size || "", quantity: 0 };
    current.quantity += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function finalizePackage(data, divisor) {
  const actualPackedWeightKg = round(number(data.actualPackedWeightKg), 3);
  const volumetricWeightKg = round((data.lengthCm * data.widthCm * data.heightCm) / divisor, 3);
  const ruleWeightKg = round(number(data.ruleWeightKg), 3);
  return {
    ...data,
    actualPackedWeightKg,
    volumetricWeightKg,
    ruleWeightKg: ruleWeightKg || null,
    chargeableWeightKg: Math.max(1, Math.ceil(Math.max(actualPackedWeightKg, volumetricWeightKg, ruleWeightKg))),
    items: itemSummary(data.units || [])
  };
}

function buildVinylPackages(units, divisor) {
  const packages = [];
  for (let index = 0; index < units.length; index += 3) {
    const chunk = units.slice(index, index + 3);
    const dims = VINYL_DIMENSIONS[chunk.length];
    packages.push(finalizePackage({
      packagingGroup: "VINYL",
      packageType: "bubble-wrap-corrugated-vinyl-mailer",
      ...dims,
      actualPackedWeightKg: 0.2 + chunk.reduce((sum, unit) => sum + (isHeavyVinyl(unit.product) ? 0.75 : 0.55), 0),
      units: chunk
    }, divisor));
  }
  return packages;
}

const SMALL_MEDIA_RULE = {
  cd: { points: 4, actualWeightKg: 0.12 },
  cassette: { points: 3, actualWeightKg: 0.09 }
};

function smallMediaDimensions(points, units) {
  const cassetteOnly = units.every((unit) => unit.kind === "cassette");
  if (cassetteOnly && units.length <= 4) return { lengthCm: 16, widthCm: 12, heightCm: 8 };
  if (cassetteOnly && units.length <= 8) return { lengthCm: 20, widthCm: 16, heightCm: 10 };
  if (points <= 8) return { lengthCm: 18, widthCm: 16, heightCm: 6 };
  if (points <= 16) return { lengthCm: 20, widthCm: 18, heightCm: 8 };
  return { lengthCm: 22, widthCm: 18, heightCm: 10 };
}

function packByPoints(units, maxPoints, ruleFor) {
  const packages = [];
  let current = [];
  let points = 0;
  for (const unit of units) {
    const unitPoints = ruleFor(unit).points;
    if (current.length && points + unitPoints > maxPoints) {
      packages.push({ units: current, points });
      current = [];
      points = 0;
    }
    current.push(unit);
    points += unitPoints;
  }
  if (current.length) packages.push({ units: current, points });
  return packages;
}

function buildSmallMediaPackages(units, divisor) {
  return packByPoints(units, 24, (unit) => SMALL_MEDIA_RULE[unit.kind]).map(({ units: chunk, points }) => {
    const dims = smallMediaDimensions(points, chunk);
    return finalizePackage({
      packagingGroup: "SMALL_MEDIA",
      packageType: "bubble-wrap-corrugated-small-media-box",
      ...dims,
      actualPackedWeightKg: 0.15 + chunk.reduce((sum, unit) => sum + SMALL_MEDIA_RULE[unit.kind].actualWeightKg, 0),
      ruleWeightKg: Math.ceil(points / 24),
      packingPoints: points,
      units: chunk
    }, divisor);
  });
}

const APPAREL_RULE = {
  tshirt: { points: 1, actualWeightKg: 0.3 },
  crewneck: { points: 3, actualWeightKg: 0.65 },
  hoodie: { points: 4, actualWeightKg: 0.9 }
};

function buildApparelPackages(units, divisor) {
  return packByPoints(units, 8, (unit) => APPAREL_RULE[unit.kind]).map(({ units: chunk, points }) => {
    const tier = Math.max(1, Math.min(4, Math.ceil(points / 2)));
    return finalizePackage({
      packagingGroup: "SOFT_APPAREL",
      packageType: "protective-poly-mailer",
      ...APPAREL_DIMENSIONS[tier],
      actualPackedWeightKg: 0.08 + chunk.reduce((sum, unit) => sum + APPAREL_RULE[unit.kind].actualWeightKg, 0),
      ruleWeightKg: tier,
      packingPoints: points,
      units: chunk
    }, divisor);
  });
}

function buildCapPackages(units, divisor) {
  const packages = [];
  for (let index = 0; index < units.length; index += 3) {
    const chunk = units.slice(index, index + 3);
    const rule = CAP_RULES[chunk.length];
    packages.push(finalizePackage({
      packagingGroup: "CAP_HARDBOX",
      packageType: "cap-hardbox",
      ...rule,
      actualPackedWeightKg: rule.ruleWeightKg,
      units: chunk
    }, divisor));
  }
  return packages;
}

function buildRingPackages(units, divisor) {
  const packages = [];
  for (let index = 0; index < units.length; index += 16) {
    const chunk = units.slice(index, index + 16);
    const quantity = chunk.length;
    const dimensions = quantity <= 4
      ? { lengthCm: 15, widthCm: 15, heightCm: 8 }
      : quantity <= 8
        ? { lengthCm: 22, widthCm: 16, heightCm: 10 }
        : { lengthCm: 25, widthCm: 20, heightCm: 15 };
    const ruleWeightKg = Math.ceil(quantity / 8);
    packages.push(finalizePackage({
      packagingGroup: "RING_HARDBOX",
      packageType: "ring-hardbox",
      ...dimensions,
      actualPackedWeightKg: ruleWeightKg,
      ruleWeightKg,
      units: chunk
    }, divisor));
  }
  return packages;
}

function buildManualPackages(units, divisor) {
  return units.map((unit) => {
    const shipping = shippingData(unit.product);
    if (!completeManualMeasurements(shipping)) throw new Error(`SHIPPING_OVERRIDE_INCOMPLETE: ${unit.sku}`);
    return finalizePackage({
      packagingGroup: explicitGroup(unit.product) || "MANUAL_OVERRIDE",
      packageType: shipping.packageType || "manual-package",
      lengthCm: number(shipping.lengthCm),
      widthCm: number(shipping.widthCm),
      heightCm: number(shipping.heightCm),
      actualPackedWeightKg: number(shipping.weightGrams) / 1000,
      manualShippingOverride: true,
      units: [unit]
    }, divisor);
  });
}

export function calculatePackages(lines, options = {}) {
  const volumetricDivisor = Math.max(1, Math.floor(number(options.volumetricDivisor, DEFAULT_VOLUMETRIC_DIVISOR)));
  const units = cartUnits(lines);
  if (!units.length) throw new Error("CART_EMPTY");
  const grouped = Object.groupBy
    ? Object.groupBy(units, (unit) => unit.group)
    : units.reduce((result, unit) => ({ ...result, [unit.group]: [...(result[unit.group] || []), unit] }), {});
  const packages = [
    ...buildVinylPackages(grouped.VINYL || [], volumetricDivisor),
    ...buildSmallMediaPackages(grouped.SMALL_MEDIA || [], volumetricDivisor),
    ...buildApparelPackages(grouped.SOFT_APPAREL || [], volumetricDivisor),
    ...buildCapPackages(grouped.CAP_HARDBOX || [], volumetricDivisor),
    ...buildRingPackages(grouped.RING_HARDBOX || [], volumetricDivisor),
    ...buildManualPackages(grouped.MANUAL_OVERRIDE || [], volumetricDivisor)
  ].map((pkg, index) => ({ ...withoutUnits(pkg), packageNumber: index + 1 }));
  return {
    calculatorVersion: SHIPPING_CALCULATOR_VERSION,
    volumetricDivisor,
    packages,
    totalChargeableWeightKg: packages.reduce((sum, pkg) => sum + pkg.chargeableWeightKg, 0)
  };
}

function withoutUnits(pkg) {
  const { units, ...clean } = pkg;
  return clean;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function priceShippingOptions(packaging, rates, { origin } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const eligible = (rates || [])
    .filter((rate) => rate.active !== false)
    .filter((rate) => !origin || String(rate.origin).toLowerCase() === String(origin).toLowerCase())
    .filter((rate) => !rate.effective_date || rate.effective_date <= today)
    .sort((a, b) => String(b.effective_date || "").localeCompare(String(a.effective_date || "")) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const services = new Map();
  for (const rate of eligible) {
    const key = `${rate.courier}::${rate.service}`;
    if (!services.has(key)) services.set(key, { courier: rate.courier, service: rate.service, eta: rate.eta || "", ratesByWeight: new Map() });
    const service = services.get(key);
    const weight = number(rate.chargeable_weight_kg);
    if (!service.ratesByWeight.has(weight)) service.ratesByWeight.set(weight, rate);
  }
  return [...services.values()].map((service) => {
    const packageRates = packaging.packages.map((pkg) => {
      const rate = service.ratesByWeight.get(pkg.chargeableWeightKg);
      return rate ? { packageNumber: pkg.packageNumber, rateId: rate.id, amount: number(rate.rate) } : null;
    });
    if (packageRates.some((rate) => !rate)) return null;
    return {
      key: `${service.courier}::${service.service}`,
      courier: service.courier,
      service: service.service,
      eta: service.eta,
      shippingTotal: packageRates.reduce((sum, rate) => sum + rate.amount, 0),
      packageRates
    };
  }).filter(Boolean).sort((a, b) => a.shippingTotal - b.shippingTotal || a.service.localeCompare(b.service));
}

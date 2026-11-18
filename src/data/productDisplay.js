export function productDisplayHeading(product = {}) {
  const artist = String(product.artist || "").trim();
  const title = String(product.title || "").trim();
  if (product.category === "Apparel" && artist) {
    return { eyebrow: title, heading: artist };
  }
  return { eyebrow: artist, heading: title };
}

export function apparelCardType(product = {}) {
  if (String(product.sku || "").trim().toUpperCase() === "NXP-2026-APP-0011") return String(product.title || "").trim();
  const candidates = [product.title, product.financeItemType, product.format, product.displayFormat, product.description];
  for (const value of candidates) {
    const text = String(value || "");
    if (/\b(?:sweatshirt|crewneck)\b/i.test(text)) return "Sweatshirt";
    if (/\b(?:knitsweater|sweater|jumper)\b/i.test(text)) return "Sweater";
    if (/\blong[ -]?sleeve\b/i.test(text)) return "Longsleeve";
    if (/\bhoodie\b/i.test(text)) return "Hoodie";
    if (/\bjacket\b/i.test(text)) return "Jacket";
    if (/\bcap\b/i.test(text)) return "Cap";
    if (/\b(?:t[ -]?shirt|tee)\b/i.test(text)) return "T-shirt";
    if (/\bshirt\b/i.test(text)) return "Shirt";
  }
  return String(product.title || "").trim();
}

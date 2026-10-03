export function productDisplayHeading(product = {}) {
  const artist = String(product.artist || "").trim();
  const title = String(product.title || "").trim();
  if (product.category === "Apparel" && artist) {
    return { eyebrow: title, heading: artist };
  }
  return { eyebrow: artist, heading: title };
}

const LOCAL_RASTER_IMAGE = /^\/public\/.+\.(?:avif|jpe?g|png|webp)(?:\?.*)?$/i;

export const productCardThumbnailWidths = [360, 720, 1080];

export function productCardThumbnailKey(product = {}) {
  return String(product.id || product.sku || "product")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "product";
}

export function canGenerateProductCardThumbnail(product = {}) {
  return LOCAL_RASTER_IMAGE.test(String(product.image || "").trim());
}

export function productCardThumbnailUrl(product, width) {
  return `/product-thumbnails/${productCardThumbnailKey(product)}-${width}.webp`;
}

export function productCardImageAttributes(product = {}) {
  const original = String(product.image || "").trim();
  if (!canGenerateProductCardThumbnail(product)) {
    return { src: original, srcset: "", fallback: "" };
  }
  return {
    src: productCardThumbnailUrl(product, 720),
    srcset: productCardThumbnailWidths.map((width) => `${productCardThumbnailUrl(product, width)} ${width}w`).join(", "),
    fallback: original
  };
}

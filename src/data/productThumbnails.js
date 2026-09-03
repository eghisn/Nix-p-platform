const LOCAL_RASTER_IMAGE = /^\/public\/.+\.(?:avif|jpe?g|png|webp)(?:\?.*)?$/i;

export const productCardThumbnailWidths = [360, 720, 1080];

export function productCardThumbnailKey(product = {}) {
  return String(product.id || product.sku || "product")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "product";
}

function productCardSource(product = {}) {
  return String(product.listingImage || product.image || "").trim();
}

export function canGenerateProductCardThumbnail(product = {}) {
  return LOCAL_RASTER_IMAGE.test(productCardSource(product));
}

export function productCardThumbnailUrl(product, width) {
  return `/product-thumbnails/${productCardThumbnailKey(product)}-${width}.webp`;
}

export function productCardImageAttributes(product = {}) {
  // Listing artwork is deliberately independent from the product gallery.
  // This keeps product pages archival while giving storefront cards a curated display image.
  const original = productCardSource(product);
  if (!canGenerateProductCardThumbnail(product)) {
    return { src: original, srcset: "", fallback: "" };
  }
  return {
    src: productCardThumbnailUrl(product, 720),
    srcset: productCardThumbnailWidths.map((width) => `${productCardThumbnailUrl(product, width)} ${width}w`).join(", "),
    fallback: original
  };
}

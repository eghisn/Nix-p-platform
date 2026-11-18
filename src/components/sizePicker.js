function escape(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function sizeIsSoldOut(size = {}) {
  return Boolean(size.soldOut) || Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) <= 0;
}

const SIZE_REQUIRED_SKUS = new Set(["NXP-2023-APP-0001", "NXP-2026-APP-0003", "NXP-2026-APP-0004", "NXP-2026-APP-0007"]);

export function requiresApparelSize(product = {}) {
  return product?.category === "Apparel" && (Boolean(product.sizes?.length) || SIZE_REQUIRED_SKUS.has(String(product.sku || "").trim().toUpperCase()));
}

export function sizePickerMarkup(product, selected = "") {
  if (!Array.isArray(product.sizes) || !product.sizes.length) return "";
  return `<div class="size-picker" aria-label="Available sizes">${product.sizes.map((size) => {
    const disabled = sizeIsSoldOut(size);
    const classes = [disabled ? "is-sold-out" : "", !disabled && selected === size.label ? "is-selected" : ""].filter(Boolean).join(" ");
    return `<button type="button" data-size-option="${escape(product.id)}" data-size-value="${escape(size.label)}" ${disabled ? "disabled" : ""} class="${classes}">${escape(size.label)}</button>`;
  }).join("")}</div>`;
}

function text(value) {
  return String(value || "").trim();
}

function legacyDetailValue(product, field) {
  const pattern = field === "catalogNumber"
    ? /^catalog\s*(?:number|no\.?)\s*:\s*(.+)$/i
    : /^barcode\s*:\s*(.+)$/i;
  return (Array.isArray(product?.details) ? product.details : [])
    .map((detail) => text(detail))
    .map((detail) => detail.match(pattern)?.[1] || "")
    .map(text)
    .find(Boolean) || "";
}

export function recordMetadataValue(product, field) {
  return text(product?.[field]) || legacyDetailValue(product, field);
}

export function needsRecordConditionDetails(product) {
  if (product?.category !== "Records") return false;
  const condition = text(product.condition).toLowerCase();
  return condition.startsWith("used") || condition === "new-unsealed" || condition === "new unsealed";
}

export function recordNotes(product) {
  const details = (Array.isArray(product?.details) ? product.details : [])
    .map((detail) => text(detail))
    .filter(Boolean);
  return product?.category === "Records"
    ? details.filter((detail) => !/^(?:catalog\s*(?:number|no\.?)|barcode)\s*:/i.test(detail))
    : details;
}

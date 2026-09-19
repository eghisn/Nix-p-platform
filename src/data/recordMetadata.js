function text(value) {
  return String(value || "").trim();
}

export const RECORD_CONDITION_GRADES = [
  "New",
  "Mint",
  "Near Mint",
  "Very Good Plus",
  "Very Good",
  "Good Plus",
  "Good",
  "Fair",
  "Poor"
];

export function normalizeRecordConditionGrade(value) {
  const candidate = text(value);
  return RECORD_CONDITION_GRADES.find((grade) => grade.toLowerCase() === candidate.toLowerCase()) || "";
}

export function recordConditionEditorValue(product, part) {
  const key = part === "sleeve" ? "sleeveCondition" : "mediaCondition";
  const grade = normalizeRecordConditionGrade(product?.[`${key}Grade`]);
  return {
    grade,
    // Earlier records only had one free-text field. Preserve it as the note
    // until an editor chooses a structured grade and saves the item again.
    note: text(product?.[`${key}Note`]) || (grade ? "" : text(product?.[key]))
  };
}

export function recordConditionLabel({ grade = "", note = "", legacy = "" } = {}) {
  const normalizedGrade = normalizeRecordConditionGrade(grade);
  const normalizedNote = text(note);
  if (normalizedGrade && normalizedNote) return `${normalizedGrade} - ${normalizedNote}`;
  return normalizedGrade || normalizedNote || text(legacy);
}

export function recordConditionDisplayValue(product, part) {
  const key = part === "sleeve" ? "sleeveCondition" : "mediaCondition";
  const value = recordConditionEditorValue(product, part);
  return recordConditionLabel({ ...value, legacy: product?.[key] });
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

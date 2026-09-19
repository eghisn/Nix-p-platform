function text(value) {
  return String(value ?? "").trim();
}

export const APPAREL_CONDITION_GRADES = Object.freeze([
  "New With Tags",
  "New Without Tags",
  "Tried On / Like New",
  "Excellent Used",
  "Very Good Used",
  "Worn / Vintage",
  "Damaged / Repair Needed"
]);

export const APPAREL_MEASUREMENT_FIELDS = Object.freeze([
  ["pitToPit", "Pit to pit"],
  ["length", "Length"],
  ["shoulder", "Shoulder"],
  ["sleeve", "Sleeve"],
  ["waist", "Waist"],
  ["inseam", "Inseam"]
]);

export function normalizeApparelCondition(value) {
  const candidate = text(value);
  return APPAREL_CONDITION_GRADES.find((grade) => grade.toLowerCase() === candidate.toLowerCase()) || candidate;
}

export function apparelConditionOptions(current = "") {
  const selected = normalizeApparelCondition(current);
  return selected && !APPAREL_CONDITION_GRADES.includes(selected)
    ? ["", selected, ...APPAREL_CONDITION_GRADES]
    : ["", ...APPAREL_CONDITION_GRADES];
}

export function normalizeApparelMeasurements(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    APPAREL_MEASUREMENT_FIELDS.map(([key]) => [key, text(source[key]).slice(0, 32)])
      .filter(([, measurement]) => measurement)
  );
}

export function apparelDetailValue(product = {}, field) {
  return text(product?.[field]) || text(product?.raw?.[field]);
}

export function apparelMeasurements(product = {}) {
  return normalizeApparelMeasurements(product?.apparelMeasurements || product?.raw?.apparelMeasurements);
}

export function apparelMeasurementSummary(product = {}) {
  const measurements = apparelMeasurements(product);
  return APPAREL_MEASUREMENT_FIELDS
    .map(([key, label]) => measurements[key] ? `${label}: ${measurements[key]} cm` : "")
    .filter(Boolean);
}

export function hasOriginalTags(product = {}) {
  return product?.originalTags === true || product?.raw?.originalTags === true;
}

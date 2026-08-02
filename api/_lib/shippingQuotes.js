import { indonesiaRegencies } from "../../src/data/indonesiaRegencies.js";
import { calculatePackages, DEFAULT_VOLUMETRIC_DIVISOR, priceShippingOptions } from "./shippingCalculator.js";
import { supabaseFetch } from "./supabase.js";

const regionByCode = new Map(indonesiaRegencies.map((region) => [region.code, region]));

export async function calculateRuleShippingQuote({ items, destinationCode, optionKey = "" }) {
  const region = regionByCode.get(String(destinationCode || ""));
  if (!region) throw checkoutError("Please select a valid Indonesian city or regency.", 400);
  const normalizedItems = normalizeRequestedItems(items);
  if (!normalizedItems.length) throw checkoutError("Cart is empty.", 400);
  const ids = [...new Set(normalizedItems.map((item) => item.id))];
  const products = await fetchShippingProducts(ids);
  if (products.length !== ids.length) throw checkoutError("One or more cart items are no longer available.", 409);
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = normalizedItems.map((item) => ({ product: byId.get(item.id), quantity: item.quantity, size: item.size }));
  const settings = await getShippingSettings();
  const packaging = calculatePackages(lines, { volumetricDivisor: settings.volumetricDivisor });
  const rates = await fetchDestinationRates(settings.origin, region.code);
  const options = priceShippingOptions(packaging, rates, { origin: settings.origin });
  const selectedOption = optionKey ? options.find((option) => option.key === optionKey) : options[0] || null;
  if (optionKey && !selectedOption) throw checkoutError("The selected shipping service is no longer available. Please refresh the quote.", 409);
  return {
    origin: settings.origin,
    destination: region,
    packaging,
    options,
    selectedOption,
    quotedAt: new Date().toISOString()
  };
}

export async function getShippingSettings() {
  const rows = await supabaseFetch("shipping_settings?select=id,origin,origin_name,volumetric_divisor,calculator_version,updated_at&id=eq.default&limit=1", { service: true });
  const row = rows?.[0] || {};
  return {
    id: "default",
    origin: row.origin || "JAKARTA",
    originName: row.origin_name || "Jakarta",
    volumetricDivisor: Math.max(1, Number(row.volumetric_divisor || DEFAULT_VOLUMETRIC_DIVISOR)),
    calculatorVersion: row.calculator_version || "nixp-rule-v1",
    updatedAt: row.updated_at || null
  };
}

export async function listShippingRates() {
  return supabaseFetch("shipping_rates?select=*&order=destination_name.asc,courier.asc,service.asc,chargeable_weight_kg.asc,effective_date.desc", { service: true });
}

export async function saveShippingSettings(input = {}) {
  const origin = clean(input.origin || "JAKARTA", 80).toUpperCase();
  const originName = clean(input.originName || "Jakarta", 120);
  const volumetricDivisor = Math.max(1, Math.floor(Number(input.volumetricDivisor || DEFAULT_VOLUMETRIC_DIVISOR)));
  await supabaseFetch("shipping_settings?on_conflict=id", {
    method: "POST",
    service: true,
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{ id: "default", origin, origin_name: originName, volumetric_divisor: volumetricDivisor, calculator_version: "nixp-rule-v1", updated_at: new Date().toISOString() }]
  });
  return getShippingSettings();
}

export async function saveShippingRate(input = {}) {
  const region = regionByCode.get(String(input.destinationCode || ""));
  if (!region) throw checkoutError("Select a valid destination.", 400);
  const row = {
    ...(input.id ? { id: String(input.id) } : {}),
    origin: clean(input.origin || "JAKARTA", 80).toUpperCase(),
    destination_code: region.code,
    destination_name: region.city,
    courier: clean(input.courier || "JNE", 80),
    service: clean(input.service, 80),
    eta: clean(input.eta, 120) || null,
    chargeable_weight_kg: Math.max(1, Math.floor(Number(input.chargeableWeightKg || 0))),
    rate: Math.max(0, Math.floor(Number(input.rate || 0))),
    effective_date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.effectiveDate || "")) ? input.effectiveDate : new Date().toISOString().slice(0, 10),
    active: input.active !== false && String(input.active || "true") !== "false",
    updated_at: new Date().toISOString()
  };
  if (!row.service) throw checkoutError("Shipping service is required.", 400);
  if (!Number.isFinite(row.rate)) throw checkoutError("Shipping rate is invalid.", 400);
  const endpoint = input.id
    ? `shipping_rates?id=eq.${encodeURIComponent(input.id)}`
    : "shipping_rates?on_conflict=origin,destination_code,courier,service,chargeable_weight_kg,effective_date";
  const method = input.id ? "PATCH" : "POST";
  const result = await supabaseFetch(endpoint, { method, service: true, prefer: input.id ? "return=representation" : "resolution=merge-duplicates,return=representation", body: input.id ? row : [row] });
  return Array.isArray(result) ? result[0] : result;
}

export async function setShippingRateActive(id, active) {
  const rows = await supabaseFetch(`shipping_rates?id=eq.${encodeURIComponent(String(id || ""))}`, {
    method: "PATCH",
    service: true,
    prefer: "return=representation",
    body: { active: Boolean(active), updated_at: new Date().toISOString() }
  });
  if (!rows?.length) throw checkoutError("Shipping rate not found.", 404);
  return rows[0];
}

async function fetchShippingProducts(ids) {
  const inFilter = ids.map((id) => `"${String(id).replaceAll('"', '')}"`).join(",");
  const rows = await supabaseFetch(`products?select=id,sku,title,artist,category,format,display_format,apparel_type,condition,publish_status,visibility,raw&id=in.(${encodeURIComponent(inFilter)})`, { service: true });
  return (rows || []).filter((row) => row.publish_status === "Published" && row.visibility === "Public");
}

async function fetchDestinationRates(origin, destinationCode) {
  const query = new URLSearchParams({
    select: "id,origin,destination_code,destination_name,courier,service,eta,chargeable_weight_kg,rate,effective_date,active,updated_at",
    origin: `eq.${origin}`,
    destination_code: `eq.${destinationCode}`,
    active: "eq.true",
    order: "effective_date.desc,updated_at.desc"
  });
  return supabaseFetch(`shipping_rates?${query.toString()}`, { service: true });
}

function normalizeRequestedItems(items) {
  const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(typeof item === "string" ? item : item?.id || "").trim();
    const size = String(typeof item === "string" ? "" : item?.size || "").trim();
    const quantity = Math.min(20, Math.max(1, Math.floor(Number(typeof item === "string" ? 1 : item?.quantity || 1))));
    if (!id) continue;
    const key = `${id}::${size}`;
    const current = grouped.get(key) || { id, size, quantity: 0 };
    current.quantity += quantity;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function clean(value, limit) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function checkoutError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

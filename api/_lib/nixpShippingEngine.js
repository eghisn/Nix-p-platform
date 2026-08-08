import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { indonesiaRegencies } from "../../src/data/indonesiaRegencies.js";
import { calculatePackages, DEFAULT_VOLUMETRIC_DIVISOR } from "./shippingCalculator.js";
import { JneOfficialClient } from "./jneOfficialClient.js";
import { supabaseFetch } from "./supabase.js";

const regionByCode = new Map(indonesiaRegencies.map((region) => [String(region.code), region]));

export class NixpShippingEngine {
  constructor(options = {}) {
    this.client = options.client || new JneOfficialClient();
  }

  async quote({ items, destinationCode, optionKey = "", persist = true }) {
    const normalizedItems = normalizeRequestedItems(items);
    if (!normalizedItems.length) throw shippingError("Cart is empty.", 400);
    const [settings, destination, products] = await Promise.all([
      getSettings(),
      this.resolveDestination(destinationCode),
      fetchShippingProducts([...new Set(normalizedItems.map((item) => item.id))])
    ]);
    if (products.length !== new Set(normalizedItems.map((item) => item.id)).size) throw shippingError("One or more cart items are no longer available.", 409);
    if (!settings.originCode) throw shippingError("NIXP JNE origin is not configured.", 503);
    const byId = new Map(products.map((product) => [product.id, product]));
    const lines = normalizedItems.map((item) => ({ product: byId.get(item.id), quantity: item.quantity, size: item.size }));
    const packaging = calculatePackages(lines, { volumetricDivisor: settings.volumetricDivisor });
    const tariffResults = [];
    for (const parcel of packaging.packages) {
      tariffResults.push(await this.tariffForParcel(settings, destination, parcel));
    }
    const options = intersectParcelServices(packaging.packages, tariffResults);
    const selectedOption = optionKey ? options.find((option) => option.key === optionKey) : options[0] || null;
    if (optionKey && !selectedOption) throw shippingError("The selected JNE service is no longer available for every parcel.", 409);
    const cartFingerprint = fingerprint({ items: normalizedItems, destinationCode: destination.jneDestinationCode, packaging });
    const result = {
      origin: { code: settings.originCode, name: settings.originName },
      destination,
      packaging,
      options,
      selectedOption,
      quotedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + settings.quoteTtlMinutes * 60_000).toISOString(),
      cartFingerprint,
      source: "JNE_OFFICIAL"
    };
    if (persist) Object.assign(result, await persistQuote(result));
    return result;
  }

  async validateQuote({ quoteToken, items, destinationCode, optionKey }) {
    const [quoteId, secret] = String(quoteToken || "").split(".");
    if (!/^[0-9a-f-]{36}$/i.test(quoteId || "") || !/^[0-9a-f]{48}$/i.test(secret || "")) throw shippingError("The shipping quote is invalid. Please recalculate shipping.", 409);
    const rows = await supabaseFetch(`shipping_quote_sessions?select=*&id=eq.${encodeURIComponent(quoteId)}&limit=1`, { service: true });
    const row = rows?.[0];
    if (!row || !safeEqual(hash(secret), row.token_hash) || row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()) throw shippingError("The shipping quote expired. Please recalculate shipping.", 409);
    const recalculated = await this.quote({ items, destinationCode, optionKey, persist: false });
    if (recalculated.cartFingerprint !== row.cart_fingerprint || String(row.destination_code) !== String(recalculated.destination.jneDestinationCode)) throw shippingError("The cart or delivery address changed. Shipping has been recalculated.", 409);
    const storedOption = row.options?.find?.((option) => option.key === optionKey);
    const currentOption = recalculated.options.find((option) => option.key === optionKey);
    if (!storedOption || !currentOption || Number(storedOption.shippingTotal) !== Number(currentOption.shippingTotal)) throw shippingError("The JNE tariff changed. Please review the updated shipping price.", 409);
    await supabaseFetch(`shipping_quote_sessions?id=eq.${encodeURIComponent(quoteId)}`, { method: "PATCH", service: true, prefer: "return=minimal", body: { last_validated_at: new Date().toISOString() } });
    return { ...recalculated, selectedOption: currentOption, quoteId };
  }

  async resolveDestination(code) {
    const requested = String(code || "").trim();
    if (!requested) throw shippingError("Please select a valid Indonesian city or regency.", 400);
    const region = regionByCode.get(requested);
    const directFilter = region ? `local_region_code=eq.${encodeURIComponent(requested)}` : `jne_destination_code=eq.${encodeURIComponent(requested)}`;
    const direct = await supabaseFetch(`jne_destinations?select=*&${directFilter}&active=eq.true&limit=1`, { service: true });
    if (direct?.[0]) return destinationFromRow(direct[0]);
    const query = region ? region.city.replace(/^(Kota|Kabupaten)\s+/i, "") : requested;
    const candidates = await this.client.searchDestinations(query);
    const selected = selectDestination(candidates, region?.city || query);
    if (!selected) throw shippingError("Shipping is currently unavailable for this destination.", 422);
    const row = destinationToRow(selected, region);
    const saved = await supabaseFetch("jne_destinations?on_conflict=jne_destination_code", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=representation", body: [row] });
    return destinationFromRow(saved?.[0] || row);
  }

  async tariffForParcel(settings, destination, parcel) {
    const weight = parcel.chargeableWeightKg;
    const cached = await readTariffCache(settings.originCode, destination.jneDestinationCode, weight);
    const fresh = cached.filter((row) => row.status === "available" && new Date(row.valid_until).getTime() > Date.now());
    if (fresh.length) return { parcelNumber: parcel.packageNumber, services: fresh.map(serviceFromCache), cacheStatus: "fresh" };
    const exactFallback = tariffCacheFallback(cached, weight, settings.maxStaleHours);
    if (exactFallback.services.length) return { parcelNumber: parcel.packageNumber, ...exactFallback };
    try {
      const official = await this.client.fetchTariff(settings.originCode, destination.jneDestinationCode, weight);
      await saveOfficialTariffs(official, settings.cacheTtlHours);
      await logSourceEvent("tariff-fetch", "success", { originCode: settings.originCode, destinationCode: destination.jneDestinationCode, weight, serviceCount: official.services.length, sourceMethod: official.sourceMethod });
      return { parcelNumber: parcel.packageNumber, services: official.services.map((service) => ({ ...service, cacheId: cacheIdentity(settings.originCode, destination.jneDestinationCode, weight, service.serviceCode), source: official.source, fetchedAt: official.fetchedAt })), cacheStatus: "refreshed" };
    } catch (error) {
      const fallback = tariffCacheFallback(cached, weight, settings.maxStaleHours);
      await logSourceEvent("tariff-fetch", fallback.services.length ? fallback.cacheStatus : "failed", { originCode: settings.originCode, destinationCode: destination.jneDestinationCode, weight, error: error instanceof Error ? error.message : "JNE unavailable" });
      if (fallback.services.length) return { parcelNumber: parcel.packageNumber, ...fallback };
      throw shippingError("JNE shipping is temporarily unavailable. Please try again shortly.", 503);
    }
  }
}

export async function shippingDashboard() {
  const now = new Date().toISOString();
  const [settings, destinations, cache, events, jobs] = await Promise.all([
    getSettings(),
    supabaseFetch("jne_destinations?select=id,active,last_synced_at", { service: true }),
    supabaseFetch(`jne_tariff_cache?select=id,status,valid_until,fetched_at&limit=5000`, { service: true }),
    supabaseFetch("shipping_source_events?select=*&order=created_at.desc&limit=30", { service: true }),
    supabaseFetch("shipping_sync_jobs?select=*&order=created_at.desc&limit=10", { service: true })
  ]);
  const lastHealth = events.find((event) => event.event_type === "health-check");
  const connection = lastHealth
    ? {
        ...(lastHealth.details || {}),
        ok: lastHealth.status === "success",
        checkedAt: lastHealth.details?.checkedAt || lastHealth.created_at,
        cached: true
      }
    : { ok: false, authenticated: settings.authenticated, source: "Not checked yet", cached: true };
  return {
    settings,
    connection,
    metrics: {
      activeDestinations: destinations.filter((row) => row.active).length,
      cachedRoutes: cache.length,
      freshTariffs: cache.filter((row) => row.status === "available" && row.valid_until > now).length,
      staleTariffs: cache.filter((row) => row.status === "available" && row.valid_until <= now).length,
      unavailableRoutes: cache.filter((row) => row.status === "unavailable").length,
      failedRequests: events.filter((row) => row.status === "failed").length
    },
    events,
    jobs
  };
}

export async function runShippingMaintenance({ mode = "daily" } = {}) {
  const client = new JneOfficialClient();
  const health = await client.healthCheck();
  await logSourceEvent("health-check", health.ok ? "success" : "failed", health);
  await supabaseFetch("shipping_quote_sessions?status=eq.active&expires_at=lt.now()", { method: "PATCH", service: true, prefer: "return=minimal", body: { status: "expired" } });
  const tariffRefresh = mode === "daily" && health.ok
    ? await refreshRecentTariffs({ limit: 2, concurrency: 2 })
    : { refreshed: 0, failed: 0, skipped: true };
  return { mode, health, tariffRefresh, completedAt: new Date().toISOString() };
}

export async function syncDestinationsNow() {
  const client = new JneOfficialClient();
  if (!client.authenticated) throw shippingError("JNE_API_ACCESS_KEY is required for the complete nationwide destination sync.", 503);
  const created = await supabaseFetch("shipping_sync_jobs", { method: "POST", service: true, prefer: "return=representation", body: [{ job_type: "destination-sync", status: "running", started_at: new Date().toISOString(), progress: {} }] });
  const job = created?.[0];
  const seenCodes = new Set();
  try {
    const progress = await client.syncAllDestinations({
      cursor: job?.progress || {},
      onPage: async (destinations, cursor) => {
        const now = new Date().toISOString();
        const rows = destinations.map((destination) => {
          seenCodes.add(destination.jneDestinationCode);
          return { ...destinationToRow(destination), last_seen_at: now, last_synced_at: now };
        });
        if (rows.length) await supabaseFetch("jne_destinations?on_conflict=jne_destination_code", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: rows });
        await supabaseFetch(`shipping_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: "PATCH", service: true, prefer: "return=minimal", body: { progress: cursor, updated_at: now } });
      }
    });
    const existing = await supabaseFetch("jne_destinations?select=id,jne_destination_code&active=eq.true", { service: true });
    const missingIds = (existing || []).filter((row) => !seenCodes.has(row.jne_destination_code)).map((row) => row.id);
    for (let index = 0; index < missingIds.length; index += 100) {
      const ids = missingIds.slice(index, index + 100).map((id) => `"${id}"`).join(",");
      await supabaseFetch(`jne_destinations?id=in.(${encodeURIComponent(ids)})`, { method: "PATCH", service: true, prefer: "return=minimal", body: { active: false, updated_at: new Date().toISOString() } });
    }
    progress.deactivated = missingIds.length;
    await supabaseFetch(`shipping_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: "PATCH", service: true, prefer: "return=minimal", body: { status: "completed", progress, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    await logSourceEvent("destination-sync", "success", progress);
    return { jobId: job.id, progress };
  } catch (error) {
    await supabaseFetch(`shipping_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: "PATCH", service: true, prefer: "return=minimal", body: { status: "failed", error: error instanceof Error ? error.message : "Destination sync failed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    throw error;
  }
}

export async function refreshRecentTariffs({ limit = 12, concurrency = 2 } = {}) {
  const settings = await getSettings();
  const client = new JneOfficialClient();
  const rows = await supabaseFetch("jne_tariff_cache?select=origin_code,destination_code,chargeable_weight_kg,fetched_at&order=fetched_at.asc&limit=120", { service: true });
  const unique = [...new Map((rows || []).map((row) => [`${row.origin_code}|${row.destination_code}|${row.chargeable_weight_kg}`, row])).values()]
    .slice(0, Math.max(1, Math.min(Number(limit) || 12, 40)));
  let refreshed = 0;
  let failed = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 2, 4, unique.length || 1));
  let cursor = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < unique.length) {
      const row = unique[cursor++];
      try {
        const result = await client.fetchTariff(row.origin_code || settings.originCode, row.destination_code, row.chargeable_weight_kg);
        await saveOfficialTariffs(result, settings.cacheTtlHours);
        refreshed += 1;
      } catch {
        failed += 1;
      }
    }
  }));
  await logSourceEvent("tariff-refresh", failed ? "partial" : "success", { refreshed, failed });
  return { refreshed, failed };
}

export async function getSettings() {
  const rows = await supabaseFetch("shipping_settings?select=*&id=eq.default&limit=1", { service: true });
  const row = rows?.[0] || {};
  return {
    id: "default",
    originCode: row.jne_origin_code || process.env.NIXP_JNE_ORIGIN_CODE || "",
    originName: row.origin_name || "NIXP Jakarta",
    volumetricDivisor: Math.max(1, Number(row.volumetric_divisor || DEFAULT_VOLUMETRIC_DIVISOR)),
    cacheTtlHours: Math.max(1, Number(row.jne_rate_cache_ttl_hours || process.env.JNE_RATE_CACHE_TTL_HOURS || 24)),
    maxStaleHours: Math.max(1, Number(row.jne_rate_max_stale_hours || process.env.JNE_RATE_MAX_STALE_HOURS || 168)),
    quoteTtlMinutes: Math.max(5, Number(row.quote_ttl_minutes || 15)),
    authenticated: Boolean(process.env.JNE_API_ACCESS_KEY)
  };
}

export async function saveSettings(input = {}) {
  const row = {
    id: "default",
    origin: String(input.originCode || input.origin || "").trim().toUpperCase(),
    jne_origin_code: String(input.originCode || input.origin || "").trim().toUpperCase(),
    origin_name: String(input.originName || "NIXP Jakarta").trim().slice(0, 120),
    volumetric_divisor: Math.max(1, Math.floor(Number(input.volumetricDivisor || 6000))),
    jne_rate_cache_ttl_hours: Math.max(1, Math.floor(Number(input.cacheTtlHours || 24))),
    jne_rate_max_stale_hours: Math.max(1, Math.floor(Number(input.maxStaleHours || 168))),
    quote_ttl_minutes: Math.max(5, Math.floor(Number(input.quoteTtlMinutes || 15))),
    calculator_version: "nixp-rule-v1",
    updated_at: new Date().toISOString()
  };
  if (!/^[A-Z0-9_-]{3,32}$/.test(row.jne_origin_code)) throw shippingError("Enter a confirmed official JNE origin code.", 400);
  await supabaseFetch("shipping_settings?on_conflict=id", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: [row] });
  return getSettings();
}

async function fetchShippingProducts(ids) {
  const inFilter = ids.map((id) => `"${String(id).replaceAll('"', "")}"`).join(",");
  const rows = await supabaseFetch(`products?select=id,sku,title,artist,category,format,display_format,apparel_type,condition,publish_status,visibility,raw&id=in.(${encodeURIComponent(inFilter)})`, { service: true });
  return (rows || []).filter((row) => row.publish_status === "Published" && row.visibility === "Public");
}

async function readTariffCache(origin, destination, weight) {
  const query = new URLSearchParams({ select: "*", origin_code: `eq.${origin}`, destination_code: `eq.${destination}`, chargeable_weight_kg: `eq.${weight}`, order: "fetched_at.desc" });
  return supabaseFetch(`jne_tariff_cache?${query}`, { service: true });
}

export function tariffCacheFallback(rows = [], requestedWeightKg, maxStaleHours = 2160) {
  const requestedWeight = Math.max(1, Math.ceil(Number(requestedWeightKg) || 1));
  const cutoff = Date.now() - Math.max(1, Number(maxStaleHours) || 1) * 60 * 60 * 1000;
  const usable = rows.filter(
    (row) => row.status === "available" && Number(row.rate) >= 0 && new Date(row.fetched_at).getTime() >= cutoff
  );
  const exact = usable.filter((row) => Number(row.chargeable_weight_kg) === requestedWeight);
  const services = latestServiceRows(exact).map(serviceFromCache);
  return { services, cacheStatus: services.length ? "stale" : "miss" };
}

function latestServiceRows(rows) {
  return [...new Map(
    [...rows]
      .sort((left, right) => new Date(right.fetched_at) - new Date(left.fetched_at))
      .map((row) => [String(row.service_code || ""), row])
  ).values()];
}

async function saveOfficialTariffs(result, ttlHours) {
  const validUntil = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const services = result.services.length ? result.services : [{ serviceCode: "__UNAVAILABLE__", serviceName: "Unavailable", shipmentType: "", rate: 0, estimatedDaysMin: null, estimatedDaysMax: null, estimatedDeliveryRaw: "" }];
  const rows = services.map((service) => ({
    id: cacheIdentity(result.originCode, result.destinationCode, result.weightKg, service.serviceCode),
    origin_code: result.originCode,
    destination_code: result.destinationCode,
    chargeable_weight_kg: result.weightKg,
    service_code: service.serviceCode,
    service_name: service.serviceName,
    shipment_type: service.shipmentType,
    rate: service.rate,
    estimated_days_min: service.estimatedDaysMin,
    estimated_days_max: service.estimatedDaysMax,
    estimated_delivery_raw: service.estimatedDeliveryRaw,
    fetched_at: result.fetchedAt,
    valid_until: validUntil,
    source: result.source,
    source_method: result.sourceMethod,
    raw_source_json: result.raw,
    status: result.services.length ? "available" : "unavailable",
    updated_at: new Date().toISOString()
  }));
  await supabaseFetch("jne_tariff_cache?on_conflict=origin_code,destination_code,chargeable_weight_kg,service_code", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: rows });
}

function intersectParcelServices(packages, tariffResults) {
  const maps = tariffResults.map((result) => new Map(result.services.map((service) => [service.serviceCode, service])));
  const common = maps.length ? [...maps[0].keys()].filter((code) => maps.every((map) => map.has(code)) && code !== "__UNAVAILABLE__") : [];
  return common.map((serviceCode) => {
    const services = maps.map((map) => map.get(serviceCode));
    const packageRates = services.map((service, index) => ({ packageNumber: packages[index].packageNumber, rateId: service.cacheId, amount: Number(service.rate), fetchedAt: service.fetchedAt, source: service.source }));
    const min = Math.max(...services.map((service) => Number(service.estimatedDaysMin || 0)));
    const max = Math.max(...services.map((service) => Number(service.estimatedDaysMax || 0)));
    return { key: `JNE::${serviceCode}`, courier: "JNE", service: serviceCode, serviceName: services[0].serviceName || serviceCode, eta: min ? `${min}-${max || min} working days` : services[0].estimatedDeliveryRaw || "", estimatedDaysMin: min || null, estimatedDaysMax: max || null, shippingTotal: packageRates.reduce((sum, rate) => sum + rate.amount, 0), packageRates };
  }).sort((a, b) => a.shippingTotal - b.shippingTotal || a.service.localeCompare(b.service));
}

async function persistQuote(quote) {
  const id = randomUUID();
  const secret = randomBytes(24).toString("hex");
  await supabaseFetch("shipping_quote_sessions", { method: "POST", service: true, prefer: "return=minimal", body: [{ id, token_hash: hash(secret), cart_fingerprint: quote.cartFingerprint, destination_code: quote.destination.jneDestinationCode, origin_code: quote.origin.code, packaging: quote.packaging, options: quote.options, source_snapshot: { source: quote.source, quotedAt: quote.quotedAt }, status: "active", expires_at: quote.expiresAt }] });
  return { quoteId: id, quoteToken: `${id}.${secret}` };
}

async function logSourceEvent(eventType, status, details) {
  return supabaseFetch("shipping_source_events", { method: "POST", service: true, prefer: "return=minimal", body: [{ event_type: eventType, status, details }] }).catch(() => undefined);
}

function destinationToRow(destination, region) {
  const now = new Date().toISOString();
  return { jne_destination_code: destination.jneDestinationCode, local_region_code: region?.code || null, destination_name: destination.destinationName, province_name: destination.provinceName || region?.province || "", city_or_regency_name: destination.cityOrRegencyName || region?.city || destination.destinationName, district_name: destination.districtName || null, subdistrict_name: destination.subdistrictName || null, postal_code: destination.postalCode || null, normalized_search_text: normalizeSearch([destination.destinationName, region?.city, region?.province].filter(Boolean).join(" ")), active: true, last_seen_at: now, last_synced_at: now, raw_source_json: destination.raw || {} };
}
function destinationFromRow(row) { return { jneDestinationCode: row.jne_destination_code, destinationName: row.destination_name, provinceName: row.province_name || "", cityOrRegencyName: row.city_or_regency_name || "", districtName: row.district_name || "", subdistrictName: row.subdistrict_name || "", postalCode: row.postal_code || "" }; }
function selectDestination(rows, wanted) { const target = normalizeSearch(wanted).replace(/^(kota|kabupaten) /, ""); return [...rows].sort((a, b) => scoreDestination(a, target) - scoreDestination(b, target))[0] || null; }
function scoreDestination(row, target) { const name = normalizeSearch(row.destinationName); if (name === target) return 0; if (name.startsWith(target)) return 1; if (name.includes(target)) return 2; return 10; }
function normalizeSearch(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function cacheIdentity(origin, destination, weight, service) { return createHash("sha256").update(`${origin}|${destination}|${weight}|${service}`).digest("hex").slice(0, 40); }
function serviceFromCache(row) { return { serviceCode: row.service_code, serviceName: row.service_name, shipmentType: row.shipment_type, rate: Number(row.rate), estimatedDaysMin: row.estimated_days_min, estimatedDaysMax: row.estimated_days_max, estimatedDeliveryRaw: row.estimated_delivery_raw, cacheId: row.id, source: row.source, fetchedAt: row.fetched_at }; }
function normalizeRequestedItems(items) { const grouped = new Map(); for (const item of Array.isArray(items) ? items : []) { const id = String(typeof item === "string" ? item : item?.id || "").trim(); const size = String(typeof item === "string" ? "" : item?.size || "").trim(); const quantity = Math.min(20, Math.max(1, Math.floor(Number(typeof item === "string" ? 1 : item?.quantity || 1)))); if (!id) continue; const key = `${id}::${size}`; const current = grouped.get(key) || { id, size, quantity: 0 }; current.quantity += quantity; grouped.set(key, current); } return [...grouped.values()].sort((a, b) => `${a.id}:${a.size}`.localeCompare(`${b.id}:${b.size}`)); }
function fingerprint(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function safeEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b); }
function shippingError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }

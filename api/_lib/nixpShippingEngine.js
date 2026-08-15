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
    const tariffResults = await Promise.all(
      packaging.packages.map((parcel) => this.tariffForParcel(settings, destination, parcel))
    );
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
      source: "NIXP_INTERNAL_JNE_SNAPSHOT"
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
    if (await hasActiveRateSnapshot()) throw shippingError("Shipping is currently unavailable for this destination.", 422);
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
    const rows = await readActiveTariffSnapshot(settings.originCode, destination.jneDestinationCode, weight);
    if (rows.length) return { parcelNumber: parcel.packageNumber, services: rows.map(serviceFromActiveRate), cacheStatus: "database-snapshot" };
    if (await hasActiveRateSnapshot()) throw shippingError("Shipping is currently unavailable for this destination.", 422);
    const cached = await readTariffCache(settings.originCode, destination.jneDestinationCode, weight);
    const fresh = cached.filter((row) => row.status === "available" && new Date(row.valid_until).getTime() > Date.now());
    if (fresh.length) return { parcelNumber: parcel.packageNumber, services: fresh.map(serviceFromCache), cacheStatus: "fresh" };
    const exactFallback = tariffCacheFallback(cached, weight, settings.maxStaleHours);
    if (exactFallback.services.length) return { parcelNumber: parcel.packageNumber, ...exactFallback };
    try {
      const official = await this.client.fetchTariff(settings.originCode, destination.jneDestinationCode, weight);
      await saveOfficialTariffs(official, settings.cacheTtlHours);
      return { parcelNumber: parcel.packageNumber, services: official.services.map((service) => ({ ...service, cacheId: cacheIdentity(settings.originCode, destination.jneDestinationCode, weight, service.serviceCode), source: official.source, fetchedAt: official.fetchedAt })), cacheStatus: "bootstrap" };
    } catch {
      throw shippingError("Shipping is currently unavailable for this destination.", 422);
    }
  }
}

export async function shippingDashboard() {
  const now = new Date().toISOString();
  const [settings, destinations, cache, events, jobs, activeVersions] = await Promise.all([
    getSettings(),
    supabaseFetch("jne_destinations?select=id,active,last_synced_at", { service: true }),
    supabaseFetch(`jne_tariff_cache?select=id,status,valid_until,fetched_at&limit=5000`, { service: true }),
    supabaseFetch("shipping_source_events?select=*&order=created_at.desc&limit=30", { service: true }),
    supabaseFetch("shipping_sync_jobs?select=*&order=created_at.desc&limit=10", { service: true }),
    supabaseFetch("shipping_rate_versions?select=id,name,status,destination_count,rate_count,verified_at,activated_at,effective_from&status=eq.active&order=activated_at.desc&limit=1", { service: true })
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
    activeRateVersion: activeVersions?.[0] || null,
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

export async function validateActiveShippingSnapshot({ sampleSize = 24 } = {}) {
  const [active, rows] = await Promise.all([
    supabaseFetch("shipping_rate_versions?select=id,name,destination_count,rate_count,verified_at,activated_at,effective_from&status=eq.active&limit=1", { service: true }),
    fetchAllRows("active_shipping_rates?select=destination_code,weight_from_kg,weight_to_kg,service_code,total_rate,rate_version_id&order=destination_code.asc,weight_from_kg.asc,service_code.asc")
  ]);
  const version = active?.[0] || null;
  const groups = new Map();
  for (const row of rows || []) {
    const key = `${row.destination_code}|${row.weight_from_kg}-${row.weight_to_kg}`;
    const group = groups.get(key) || { key, destinationCode: row.destination_code, weightFromKg: row.weight_from_kg, weightToKg: row.weight_to_kg, services: [] };
    group.services.push(row);
    groups.set(key, group);
  }
  const results = [...groups.values()].slice(0, Math.max(1, Math.min(Number(sampleSize) || 24, 100))).map((group) => {
    const invalid = !group.destinationCode || !Number.isInteger(Number(group.weightFromKg)) || Number(group.weightFromKg) < 1 || Number(group.weightToKg) < Number(group.weightFromKg) || !group.services.length || group.services.some((service) => !service.service_code || !Number.isFinite(Number(service.total_rate)) || Number(service.total_rate) < 0);
    return { ...group, ok: !invalid, services: group.services.length, reason: invalid ? "Invalid destination, weight range, service, or non-negative rate." : null };
  });
  const mismatchCount = results.filter((result) => !result.ok).length;
  const verifiedAt = version?.verified_at || version?.activated_at || null;
  const maxAgeDays = Math.max(1, Number(process.env.NIXP_SHIPPING_SNAPSHOT_MAX_AGE_DAYS || 30));
  const ageDays = verifiedAt ? Math.floor((Date.now() - new Date(verifiedAt).getTime()) / 86_400_000) : null;
  const warnings = [];
  if (!version) warnings.push("No active shipping rate version.");
  if (version && ageDays !== null && ageDays > maxAgeDays) warnings.push(`Active shipping rate snapshot is ${ageDays} days old.`);
  if (version && !verifiedAt) warnings.push("Active shipping rate snapshot has no verification timestamp.");
  if (version && Number(version.destination_count || 0) > 0 && new Set(rows.map((row) => row.destination_code)).size < Number(version.destination_count)) warnings.push("Active shipping snapshot has fewer destinations than its recorded coverage.");
  if (!rows.length) warnings.push("Active shipping snapshot contains no rates.");
  const status = version && rows.length && mismatchCount === 0 && !warnings.length ? "passed" : "failed";
  const validation = {
    status,
    sampleSize: results.length,
    matchedCount: results.filter((result) => result.ok).length,
    mismatchCount,
    destinationCount: new Set(rows.map((row) => row.destination_code)).size,
    rateCount: rows.length,
    activeRateVersion: version,
    ageDays,
    maxAgeDays,
    warnings,
    results,
    completedAt: new Date().toISOString()
  };
  await supabaseFetch("shipping_validation_runs", {
    method: "POST",
    service: true,
    prefer: "return=minimal",
    body: [{ sample_size: validation.sampleSize, matched_count: validation.matchedCount, mismatch_count: validation.mismatchCount, status: validation.status, results: validation.results, completed_at: validation.completedAt }]
  });
  await logSourceEvent("validation", status, validation);
  return validation;
}

export async function runShippingMaintenance({ mode = "daily" } = {}) {
  const active = await supabaseFetch("shipping_rate_versions?select=id,name,destination_count,rate_count,verified_at,activated_at,effective_from&status=eq.active&limit=1", { service: true });
  let validation;
  try {
    validation = await validateActiveShippingSnapshot();
  } catch (error) {
    validation = { status: "failed", sampleSize: 0, matchedCount: 0, mismatchCount: 0, warnings: [error instanceof Error ? error.message : "Shipping validation failed."], completedAt: new Date().toISOString() };
    await logSourceEvent("validation", "failed", validation);
  }
  const health = { ok: Boolean(active?.[0]) && validation.status === "passed", source: "NIXP internal JNE rate snapshot", activeRateVersion: active?.[0] || null, validation, checkedAt: new Date().toISOString() };
  await logSourceEvent("health-check", health.ok ? "success" : "failed", health);
  await supabaseFetch("shipping_quote_sessions?status=eq.active&expires_at=lt.now()", { method: "PATCH", service: true, prefer: "return=minimal", body: { status: "expired" } });
  const tariffRefresh = { refreshed: 0, failed: 0, skipped: true, reason: "Checkout uses an activated immutable database snapshot." };
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

export async function importPublicTariffSnapshot(input = {}) {
  const versionName = String(input.versionName || "").trim().slice(0, 120);
  if (!versionName) throw shippingError("A rate version name is required.", 400);
  const destinations = Array.isArray(input.destinations) ? input.destinations : [];
  const tariffs = Array.isArray(input.tariffs) ? input.tariffs : [];
  if (destinations.length > 100 || tariffs.length > 100) throw shippingError("Shipping import batches may contain at most 100 rows.", 400);
  const version = await getOrCreateDraftRateVersion(versionName);
  const imported = { versionId: version.id, destinations: 0, tariffs: 0, rates: 0 };

  if (destinations.length) imported.destinations = await importDestinationMappings(destinations);
  if (tariffs.length) {
    const tariffImport = await importTariffRows(version.id, tariffs);
    imported.tariffs = tariffImport.tariffs;
    imported.rates = tariffImport.rates;
  }

  if (!input.finalize) return imported;
  const weights = [...new Set((input.weights || []).map(Number).filter((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 20))];
  const expectedDestinationCount = Math.max(1, Math.floor(Number(input.expectedDestinationCount || 0)));
  if (!weights.length || !expectedDestinationCount) throw shippingError("Finalization requires destination and weight coverage targets.", 400);
  const coverage = await rateVersionCoverage(version.id);
  const expectedCombinations = expectedDestinationCount * weights.length;
  const missing = expectedCombinations - coverage.combinationCount;
  if (missing > 0) throw shippingError(`Rate version is incomplete: ${missing} destination/weight combinations are missing.`, 409);
  const summary = {
    expectedDestinationCount,
    weights,
    expectedCombinations,
    combinationCount: coverage.combinationCount,
    rateCount: coverage.rateCount,
    verifiedAt: new Date().toISOString()
  };
  await supabaseFetch(`shipping_rate_versions?id=eq.${encodeURIComponent(version.id)}`, {
    method: "PATCH",
    service: true,
    prefer: "return=minimal",
    body: { acquisition_summary: summary, destination_count: expectedDestinationCount, rate_count: coverage.rateCount, verified_at: summary.verifiedAt }
  });
  await supabaseFetch("rpc/activate_shipping_rate_version", { method: "POST", service: true, body: { p_version_id: version.id } });
  await logSourceEvent("tariff-snapshot-activation", "success", { versionId: version.id, ...summary });
  return { ...imported, activated: true, coverage: summary };
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

async function readActiveTariffSnapshot(origin, destination, weight) {
  const query = [
    `origin_code=eq.${encodeURIComponent(origin)}`,
    `destination_code=eq.${encodeURIComponent(destination)}`,
    `weight_from_kg=lte.${encodeURIComponent(weight)}`,
    `weight_to_kg=gte.${encodeURIComponent(weight)}`,
    "select=*",
    "order=total_rate.asc"
  ].join("&");
  return supabaseFetch(`active_shipping_rates?${query}`, { service: true });
}

async function hasActiveRateSnapshot() {
  const rows = await supabaseFetch("shipping_rate_versions?select=id&status=eq.active&limit=1", { service: true });
  return Boolean(rows?.[0]);
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

async function getOrCreateDraftRateVersion(name) {
  const current = await supabaseFetch(`shipping_rate_versions?select=*&name=eq.${encodeURIComponent(name)}&status=eq.draft&limit=1`, { service: true });
  if (current?.[0]) return current[0];
  const created = await supabaseFetch("shipping_rate_versions", {
    method: "POST",
    service: true,
    prefer: "return=representation",
    body: [{ name, effective_from: new Date().toISOString().slice(0, 10), status: "draft", source: "JNE_OFFICIAL" }]
  });
  return created[0];
}

async function importDestinationMappings(inputs) {
  const normalized = inputs.map((input) => {
    const localRegionCode = String(input.localRegionCode || "").trim();
    const jneDestinationCode = String(input.jneDestinationCode || "").trim().toUpperCase();
    const cityName = String(input.cityName || "").trim().slice(0, 160);
    const provinceName = String(input.provinceName || "").trim().slice(0, 120);
    const destinationName = String(input.destinationName || "").trim().slice(0, 180);
    if (!/^\d{2}\.\d{2}$/.test(localRegionCode) || !/^[A-Z0-9_-]{3,32}$/.test(jneDestinationCode) || !cityName || !provinceName || !destinationName) {
      throw shippingError("A destination import row is invalid.", 400);
    }
    return { ...input, localRegionCode, jneDestinationCode, cityName, provinceName, destinationName };
  });
  const now = new Date().toISOString();
  const uniqueJneInputs = [...new Map(normalized.map((input) => [input.jneDestinationCode, input])).values()];
  const saved = await supabaseFetch("jne_destinations?on_conflict=jne_destination_code", {
    method: "POST",
    service: true,
    prefer: "resolution=merge-duplicates,return=representation",
    body: uniqueJneInputs.map((input) => ({
      jne_destination_code: input.jneDestinationCode,
      local_region_code: input.localRegionCode,
      destination_name: input.destinationName,
      province_name: input.provinceName,
      city_or_regency_name: input.cityName,
      normalized_search_text: normalizeSearch(`${input.cityName} ${input.provinceName} ${input.destinationName}`),
      active: true,
      last_seen_at: now,
      last_synced_at: now,
      raw_source_json: input.rawSource || {},
      updated_at: now
    }))
  });
  const jneByCode = new Map(saved.map((row) => [row.jne_destination_code, row]));
  const currentRows = await supabaseFetch("shipping_destinations?select=id,city_code,jne_destination_id&city_code=not.is.null&limit=1000", { service: true });
  const currentByCode = new Map(currentRows.map((row) => [row.city_code, row]));
  const inserts = [];
  for (const input of normalized) {
    const jne = jneByCode.get(input.jneDestinationCode);
    if (!jne) throw shippingError(`Destination ${input.localRegionCode} could not be persisted.`, 409);
    const row = { jne_destination_id: jne.id, country_code: "ID", province_code: input.localRegionCode.split(".")[0], province_name: input.provinceName, city_code: input.localRegionCode, city_name: input.cityName, active: true, updated_at: now };
    const current = currentByCode.get(input.localRegionCode);
    if (current) {
      if (current.jne_destination_id !== jne.id) await supabaseFetch(`shipping_destinations?id=eq.${encodeURIComponent(current.id)}`, { method: "PATCH", service: true, prefer: "return=minimal", body: row });
    } else {
      inserts.push(row);
    }
  }
  if (inserts.length) await supabaseFetch("shipping_destinations", { method: "POST", service: true, prefer: "return=minimal", body: inserts });
  return normalized.length;
}

async function importTariffRows(versionId, inputs) {
  const normalized = inputs.map((input) => {
    const localRegionCode = String(input.localRegionCode || "").trim();
    const destinationCode = String(input.destinationCode || "").trim().toUpperCase();
    const weight = Math.ceil(Number(input.weight));
    const services = Array.isArray(input.services) ? input.services : [];
    if (!/^\d{2}\.\d{2}$/.test(localRegionCode) || !/^[A-Z0-9_-]{3,32}$/.test(destinationCode) || !Number.isInteger(weight) || weight < 1 || weight > 20 || !services.length) throw shippingError("A tariff import row is invalid.", 400);
    return { ...input, localRegionCode, destinationCode, weight, services };
  });
  const destinationRows = await supabaseFetch("shipping_destinations?select=id,city_code,jne_destinations!inner(jne_destination_code)&active=eq.true&limit=1000", { service: true });
  const destinationByKey = new Map(destinationRows.map((row) => [`${row.city_code}|${row.jne_destinations?.jne_destination_code}`, row]));
  const serviceInputs = new Map();
  for (const tariff of normalized) {
    for (const service of tariff.services) {
      const serviceCode = String(service.serviceCode || "").trim().toUpperCase().slice(0, 40);
      const rate = Number(service.rate);
      if (!serviceCode || !Number.isInteger(rate) || rate < 0) throw shippingError("A JNE service rate is invalid.", 400);
      serviceInputs.set(serviceCode, { ...service, serviceCode, rate });
    }
  }
  const now = new Date().toISOString();
  const services = await supabaseFetch("shipping_services?on_conflict=courier_name,service_code", {
    method: "POST",
    service: true,
    prefer: "resolution=merge-duplicates,return=representation",
    body: [...serviceInputs.values()].map((service) => ({ courier_name: "JNE", service_code: service.serviceCode, service_name: String(service.serviceName || service.serviceCode).slice(0, 100), description: String(service.shipmentType || "").slice(0, 160) || null, estimated_days_min: nullableInteger(service.estimatedDaysMin), estimated_days_max: nullableInteger(service.estimatedDaysMax), active: true, updated_at: now }))
  });
  const serviceByCode = new Map(services.map((row) => [row.service_code, row]));
  const rateRows = [];
  const cacheRows = [];
  for (const tariff of normalized) {
    const destination = destinationByKey.get(`${tariff.localRegionCode}|${tariff.destinationCode}`);
    if (!destination) throw shippingError(`Destination ${tariff.localRegionCode} has not been imported.`, 409);
    const fetchedAt = validTimestamp(tariff.fetchedAt) || now;
    for (const rawService of tariff.services) {
      const serviceCode = String(rawService.serviceCode || "").trim().toUpperCase().slice(0, 40);
      const service = serviceByCode.get(serviceCode);
      if (!service) throw shippingError(`JNE service ${serviceCode} could not be persisted.`, 409);
      const rate = Number(rawService.rate);
      rateRows.push({ rate_version_id: versionId, origin_code: "CGK10000", destination_id: destination.id, shipping_service_id: service.id, weight_from_kg: tariff.weight, weight_to_kg: tariff.weight, rate, surcharge: 0, estimated_days_min: nullableInteger(rawService.estimatedDaysMin), estimated_days_max: nullableInteger(rawService.estimatedDaysMax), estimated_delivery_raw: String(rawService.estimatedDeliveryRaw || "").slice(0, 100), source_checksum: String(tariff.checksum || "").slice(0, 128) || null, acquired_at: fetchedAt, active: true, updated_at: now });
      cacheRows.push({ id: cacheIdentity("CGK10000", tariff.destinationCode, tariff.weight, serviceCode), origin_code: "CGK10000", destination_code: tariff.destinationCode, chargeable_weight_kg: tariff.weight, service_code: serviceCode, service_name: String(rawService.serviceName || serviceCode).slice(0, 100), shipment_type: String(rawService.shipmentType || "").slice(0, 160) || null, rate, estimated_days_min: nullableInteger(rawService.estimatedDaysMin), estimated_days_max: nullableInteger(rawService.estimatedDaysMax), estimated_delivery_raw: String(rawService.estimatedDeliveryRaw || "").slice(0, 100), fetched_at: fetchedAt, valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), source: "JNE_OFFICIAL", source_method: "official-public-checker-snapshot", raw_source_json: { checksum: String(tariff.checksum || "").slice(0, 128), acquiredAt: fetchedAt }, status: "available", updated_at: now });
    }
  }
  const uniqueRates = uniqueRows(rateRows, (row) => `${row.rate_version_id}|${row.origin_code}|${row.destination_id}|${row.shipping_service_id}|${row.weight_from_kg}|${row.weight_to_kg}`, "rate");
  const uniqueCache = uniqueRows(cacheRows, (row) => `${row.origin_code}|${row.destination_code}|${row.chargeable_weight_kg}|${row.service_code}`, "rate");
  await supabaseFetch("shipping_rates?on_conflict=rate_version_id,origin_code,destination_id,shipping_service_id,weight_from_kg,weight_to_kg", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: uniqueRates });
  await supabaseFetch("jne_tariff_cache?on_conflict=origin_code,destination_code,chargeable_weight_kg,service_code", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: uniqueCache });
  return { tariffs: normalized.length, rates: uniqueRates.length };
}

async function rateVersionCoverage(versionId) {
  const rows = await fetchAllRows(`shipping_rates?select=id,destination_id,weight_from_kg&rate_version_id=eq.${encodeURIComponent(versionId)}&active=eq.true`);
  return { rateCount: rows.length, combinationCount: new Set(rows.map((row) => `${row.destination_id}|${row.weight_from_kg}`)).size };
}

async function fetchAllRows(path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseFetch(`${path}${path.includes("?") ? "&" : "?"}limit=${pageSize}&offset=${offset}`, { service: true });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function nullableInteger(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
function validTimestamp(value) { const time = new Date(value || "").getTime(); return Number.isFinite(time) ? new Date(time).toISOString() : ""; }
function uniqueRows(rows, keyFor, comparedField) {
  const unique = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const current = unique.get(key);
    if (current && Number(current[comparedField]) !== Number(row[comparedField])) throw shippingError(`Conflicting duplicate shipping row: ${key}.`, 409);
    unique.set(key, row);
  }
  return [...unique.values()];
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
function serviceFromActiveRate(row) { return { serviceCode: row.service_code, serviceName: row.service_name, shipmentType: row.description || "Document/Paket", rate: Number(row.total_rate), estimatedDaysMin: row.estimated_days_min, estimatedDaysMax: row.estimated_days_max, estimatedDeliveryRaw: row.estimated_days_min ? `${row.estimated_days_min}-${row.estimated_days_max || row.estimated_days_min} D` : "", cacheId: row.rate_id, source: "NIXP_INTERNAL_JNE_SNAPSHOT", fetchedAt: row.activated_at, rateVersionId: row.rate_version_id }; }
function normalizeRequestedItems(items) { const grouped = new Map(); for (const item of Array.isArray(items) ? items : []) { const id = String(typeof item === "string" ? item : item?.id || "").trim(); const size = String(typeof item === "string" ? "" : item?.size || "").trim(); const quantity = Math.min(20, Math.max(1, Math.floor(Number(typeof item === "string" ? 1 : item?.quantity || 1)))); if (!id) continue; const key = `${id}::${size}`; const current = grouped.get(key) || { id, size, quantity: 0 }; current.quantity += quantity; grouped.set(key, current); } return [...grouped.values()].sort((a, b) => `${a.id}:${a.size}`.localeCompare(`${b.id}:${b.size}`)); }
function fingerprint(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function safeEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b); }
function shippingError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }

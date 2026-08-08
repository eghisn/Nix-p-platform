const API_BASE = "https://shipping.jne.co.id";
const PUBLIC_BASE = "https://www.jne.co.id";
const PUBLIC_BASE_FALLBACK = "https://jne.co.id";
const REQUEST_TIMEOUT_MS = 4500;
const PUBLIC_RETRY_DELAYS_MS = [0, 350];

export class JneOfficialClient {
  constructor(options = {}) {
    this.accessKey = String(options.accessKey || process.env.JNE_API_ACCESS_KEY || "").trim();
    this.apiBase = String(options.apiBase || process.env.JNE_API_BASE_URL || API_BASE).replace(/\/$/, "");
    this.publicBases = [...new Set(
      (options.publicBases || [options.publicBase, PUBLIC_BASE, PUBLIC_BASE_FALLBACK])
        .filter(Boolean)
        .map((base) => String(base).replace(/\/$/, ""))
    )];
    this.publicBase = this.publicBases[0];
  }

  get authenticated() {
    return Boolean(this.accessKey);
  }

  async searchDestinations(query) {
    const search = cleanQuery(query);
    if (search.length < 3) return [];
    if (this.authenticated) {
      const payload = await this.#request(`/v1/jne/destination?zip_code=${encodeURIComponent(search)}`);
      const rows = arrayPayload(payload);
      if (rows.length) return rows.map(normalizeDestination).filter(Boolean);
    }
    const payload = await this.#publicJson(`/api-destination?search=${encodeURIComponent(search)}`);
    return arrayPayload(payload).map(normalizeDestination).filter(Boolean);
  }

  async fetchTariff(originCode, destinationCode, weightKg) {
    const origin = officialCode(originCode, "origin");
    const destination = officialCode(destinationCode, "destination");
    const weight = positiveInteger(weightKg, "weight");
    if (this.authenticated) {
      const raw = await this.#request("/v1/jne/tariff-zip-code", {
        method: "POST",
        body: { from: origin, thru: destination, weight: String(weight) }
      });
      return normalizeTariffResponse({ origin, destination, weight, raw, sourceMethod: "authenticated-api" });
    }
    const response = await this.#publicFetch(`/en/shipping-fee?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&weight=${weight}`);
    const html = await response.text();
    if (!response.ok) throw sourceError(`JNE public checker returned HTTP ${response.status}.`, response.status);
    const tariffTableHtml = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0] || "";
    return normalizeTariffResponse({
      origin,
      destination,
      weight,
      raw: { html: tariffTableHtml, url: response.url },
      services: parsePublicTariffHtml(tariffTableHtml),
      sourceMethod: "official-public-checker"
    });
  }

  async fetchAvailableServices(originCode, destinationCode, weightKg) {
    return (await this.fetchTariff(originCode, destinationCode, weightKg)).services;
  }

  async healthCheck() {
    const started = Date.now();
    try {
      const rows = await this.searchDestinations("Bandung");
      return { ok: rows.length > 0, authenticated: this.authenticated, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), source: this.authenticated ? "JNE authenticated API" : "JNE official public endpoint" };
    } catch (error) {
      return { ok: false, authenticated: this.authenticated, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "JNE source unavailable" };
    }
  }

  async syncAllDestinations({ cursor = {}, onPage } = {}) {
    if (!this.authenticated) throw sourceError("JNE_API_ACCESS_KEY is required for a complete nationwide destination sync.", 503);
    const progress = { provincePage: Number(cursor.provincePage || 1), cityPage: Number(cursor.cityPage || 1), districtPage: Number(cursor.districtPage || 1), processed: Number(cursor.processed || 0) };
    const provinces = await this.#paged("/v1/jne/provinces", progress.provincePage);
    for (const province of provinces.rows) {
      let cityPage = progress.cityPage;
      do {
        const cities = await this.#paged("/v1/jne/cities", cityPage, { province_code: province.code || province.province_code });
        for (const city of cities.rows) {
          let districtPage = progress.districtPage;
          do {
            const districts = await this.#paged("/v1/jne/districts", districtPage, { province_code: province.code || province.province_code, city_name: city.name || city.city_name });
            const normalized = districts.rows.map((row) => normalizeDestination({ ...row, province_name: province.name || province.province_name, city_name: city.name || city.city_name })).filter(Boolean);
            progress.processed += normalized.length;
            progress.districtPage = districtPage;
            await onPage?.(normalized, { ...progress });
            districtPage += 1;
          } while (districtPage <= Number(districts.lastPage || 1));
          progress.districtPage = 1;
        }
        cityPage += 1;
        progress.cityPage = cityPage;
      } while (cityPage <= Number(cities.lastPage || 1));
      progress.cityPage = 1;
    }
    return progress;
  }

  async #paged(path, page, params = {}) {
    const query = new URLSearchParams({ page: String(page), per_page: "100", ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)) });
    const payload = await this.#request(`${path}?${query}`);
    const meta = payload?.meta || payload?.pagination || {};
    return { rows: arrayPayload(payload), lastPage: Number(meta.last_page || meta.lastPage || 1) };
  }

  async #request(path, options = {}) {
    if (!this.authenticated) throw sourceError("JNE authenticated API access is not configured.", 503);
    const response = await this.#fetch(`${this.apiBase}${path}`, {
      method: options.method || "GET",
      headers: { authorization: this.accessKey, "content-type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw sourceError(payload?.message || `JNE API returned HTTP ${response.status}.`, response.status);
    return payload;
  }

  async #publicJson(path) {
    const response = await this.#publicFetch(path);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw sourceError(`JNE public endpoint returned HTTP ${response.status}.`, response.status);
    return payload;
  }

  async #fetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,id;q=0.8",
          referer: `${this.publicBase}/en/shipping-fee`,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36 NIXP/1.0",
          ...(options.headers || {})
        }
      });
    } catch (error) {
      throw sourceError(error?.name === "AbortError" ? "JNE request timed out." : "JNE official source could not be reached.", 503);
    } finally {
      clearTimeout(timer);
    }
  }

  async #publicFetch(pathOrUrl, options = {}) {
    let lastResponse = null;
    const absolute = /^https?:\/\//i.test(pathOrUrl);
    const bases = absolute ? [""] : this.publicBases;
    for (const base of bases) {
      for (const delayMs of PUBLIC_RETRY_DELAYS_MS) {
        if (delayMs) await delay(delayMs);
        lastResponse = await this.#fetch(absolute ? pathOrUrl : `${base}${pathOrUrl}`, options);
        if (lastResponse.ok || !shouldRetryStatus(lastResponse.status)) return lastResponse;
      }
    }
    return lastResponse;
  }
}

export function parsePublicTariffHtml(html = "") {
  const table = String(html).match(/<table[^>]*>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/i)?.[1] || "";
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.map((match) => {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => decodeHtml(stripTags(cell[1])).trim());
    if (cells.length < 4) return null;
    const rate = Number(cells[2].replace(/[^0-9]/g, ""));
    if (!cells[0] || !Number.isFinite(rate)) return null;
    const eta = parseEta(cells[3]);
    return { serviceCode: cells[0], serviceName: cells[0], shipmentType: cells[1], rate, estimatedDaysMin: eta.min, estimatedDaysMax: eta.max, estimatedDeliveryRaw: cells[3] };
  }).filter(Boolean);
}

function normalizeTariffResponse({ origin, destination, weight, raw, services, sourceMethod }) {
  const sourceRows = services || arrayPayload(raw);
  const normalized = sourceRows.map(normalizeService).filter(Boolean);
  return { originCode: origin, destinationCode: destination, weightKg: weight, services: normalized, source: "JNE_OFFICIAL", sourceMethod, fetchedAt: new Date().toISOString(), raw };
}

function normalizeService(row = {}) {
  if (row.serviceCode && Number.isFinite(Number(row.rate))) return row;
  const serviceCode = String(row.service_code || row.code || row.service || row.product || "").trim();
  const rate = Number(row.rate || row.tariff || row.price || row.value);
  if (!serviceCode || !Number.isFinite(rate)) return null;
  const rawEta = String(row.etd || row.estimated_delivery || row.estimated_days || "").trim();
  const eta = parseEta(rawEta);
  return { serviceCode, serviceName: String(row.service_name || row.name || serviceCode), shipmentType: String(row.shipment_type || row.type || "Document/Paket"), rate, estimatedDaysMin: eta.min, estimatedDaysMax: eta.max, estimatedDeliveryRaw: rawEta };
}

function normalizeDestination(row = {}) {
  const code = String(row.code || row.jne_destination_code || row.destination_code || row.zip_code || "").trim();
  const name = String(row.label || row.destination_name || row.name || row.district_name || row.city_name || "").trim();
  if (!code || !name) return null;
  return { jneDestinationCode: code, destinationName: name, provinceName: String(row.province_name || row.province || ""), cityOrRegencyName: String(row.city_name || row.city_or_regency_name || ""), districtName: String(row.district_name || row.district || ""), subdistrictName: String(row.subdistrict_name || row.subdistrict || ""), postalCode: String(row.postal_code || row.zip_code || ""), raw: row };
}

function arrayPayload(payload) {
  const candidates = [payload?.data?.data, payload?.data, payload?.results, payload?.result, payload];
  return candidates.find(Array.isArray) || [];
}

function parseEta(value) {
  const numbers = String(value || "").match(/\d+/g)?.map(Number) || [];
  return { min: numbers[0] ?? null, max: numbers[1] ?? numbers[0] ?? null };
}

function stripTags(value) { return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }
function decodeHtml(value) { return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replaceAll("&nbsp;", " "); }
function cleanQuery(value) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80); }
function officialCode(value, label) { const code = String(value || "").trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw sourceError(`Invalid JNE ${label} code.`, 400); return code; }
function positiveInteger(value, label) { const parsed = Math.ceil(Number(value)); if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) throw sourceError(`Invalid JNE ${label}.`, 400); return parsed; }
function sourceError(message, statusCode = 500) { const error = new Error(message); error.statusCode = statusCode; return error; }
function shouldRetryStatus(status) { return status === 403 || status === 408 || status === 429 || status >= 500; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

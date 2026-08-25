import { inventoryFingerprint, RELATED_ARTIST_RESEARCH_VERSION } from "./catalogEnrichment.js";
import { supabaseFetch } from "./supabase.js";

const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const ACTIVE_STATUSES = new Set(["queued", "processing", "retry", "ready", "deployment_pending"]);

function now() {
  return new Date().toISOString();
}

function normalizedSku(value) {
  return String(value || "").trim().toUpperCase();
}

function quoteList(values = []) {
  return values.map((value) => `"${String(value).replaceAll('"', '\\"')}"`).join(",");
}

function jobId(sku, fingerprint) {
  const compact = String(fingerprint || "").replace(/[^a-z0-9]+/gi, "").slice(0, 40).toLowerCase();
  return `catalog-research-${String(sku).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${compact || "pending"}`;
}

export function isResearchableCatalogStock(stock = {}) {
  const format = String(stock.item || stock.format || "").trim();
  const title = String(stock.title || "").trim();
  const artist = String(stock.artist || "").trim();
  const sellingPrice = Number(stock.sellingPrice || 0);
  const minimumOffer = Number(stock.minimumAcceptableOffer || 0);
  const offerOnly = stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true;
  return Boolean(normalizedSku(stock.sku) && RECORD_FORMATS.has(format) && title && artist && (offerOnly ? minimumOffer > 0 : sellingPrice > 0));
}

export function catalogResearchRequest(stock = {}, { requestedBy = "finance" } = {}) {
  const sku = normalizedSku(stock.sku);
  const requestFingerprint = inventoryFingerprint({ ...stock, sku, format: stock.item || stock.format });
  return {
    id: jobId(sku, requestFingerprint),
    sku,
    request_fingerprint: requestFingerprint,
    research_version: RELATED_ARTIST_RESEARCH_VERSION,
    status: "queued",
    stage: "queued",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: now(),
    completed_at: null,
    last_error_code: null,
    last_error_message: null,
    last_error_source: null,
    result: { requestedBy, artist: String(stock.artist || "").trim(), title: String(stock.title || "").trim(), format: String(stock.item || stock.format || "").trim() },
    updated_at: now()
  };
}

export async function enqueueCatalogResearchJobs(stockRows = [], { requestedBy = "finance", force = false, skus = [] } = {}) {
  const targets = new Set((skus || []).map(normalizedSku).filter(Boolean));
  // Broad inventory saves must never create a catalogue-wide research backlog.
  // Every queued job needs an explicit SKU from Research & Complete (or a
  // separately implemented, deliberately confirmed bulk action).
  if (!targets.size) return { queued: 0, jobs: [] };
  const jobs = stockRows
    .filter(isResearchableCatalogStock)
    .filter((stock) => targets.has(normalizedSku(stock.sku)))
    .map((stock) => catalogResearchRequest(stock, { requestedBy }));
  if (!jobs.length) return { queued: 0, jobs: [] };

  if (force) {
    for (const job of jobs) {
      await supabaseFetch(`catalog_research_jobs?sku=eq.${encodeURIComponent(job.sku)}&research_version=eq.${encodeURIComponent(job.research_version)}`, {
        method: "PATCH",
        service: true,
        body: {
          status: "queued",
          stage: "queued",
          next_retry_at: now(),
          completed_at: null,
          last_error_code: null,
          last_error_message: null,
          last_error_source: null,
          updated_at: now()
        },
        prefer: "return=minimal"
      });
    }
  }

  await supabaseFetch("catalog_research_jobs?on_conflict=sku,request_fingerprint,research_version", {
    method: "POST",
    service: true,
    body: jobs,
    prefer: "resolution=ignore-duplicates,return=minimal"
  });
  return { queued: jobs.length, jobs };
}

export async function claimCatalogResearchJobs({ limit = 1, skus = [] } = {}) {
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 1));
  const targets = [...new Set((skus || []).map(normalizedSku).filter(Boolean))];
  const nowValue = encodeURIComponent(now());
  const filter = targets.length ? `&sku=in.(${quoteList(targets)})` : "";
  const rows = await supabaseFetch(
    `catalog_research_jobs?select=*&status=in.(queued,retry)&next_retry_at=lte.${nowValue}${filter}&order=created_at.asc&limit=${safeLimit * 3}`,
    { service: true }
  );
  const claimed = [];
  for (const row of rows || []) {
    if (claimed.length >= safeLimit) break;
    const previousStatus = String(row.status || "");
    const updates = {
      status: "processing",
      stage: "matching_release",
      started_at: now(),
      attempt_count: Number(row.attempt_count || 0) + 1,
      updated_at: now()
    };
    const updated = await supabaseFetch(
      `catalog_research_jobs?id=eq.${encodeURIComponent(row.id)}&status=eq.${encodeURIComponent(previousStatus)}`,
      { method: "PATCH", service: true, body: updates, prefer: "return=representation" }
    );
    if (updated?.[0]) claimed.push({ ...row, ...updated[0] });
  }
  return claimed;
}

export function retryDelaySeconds(attemptCount = 1) {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, Number(attemptCount || 1) - 1)));
}

export async function completeCatalogResearchJob(job, { status = "ready", stage = "validating", result = {} } = {}) {
  return supabaseFetch(`catalog_research_jobs?id=eq.${encodeURIComponent(job.id)}`, {
    method: "PATCH",
    service: true,
    body: {
      status,
      stage,
      completed_at: ["ready", "live", "failed", "cancelled"].includes(status) ? now() : null,
      next_retry_at: now(),
      last_error_code: null,
      last_error_message: null,
      last_error_source: null,
      result: { ...(job.result || {}), ...result },
      updated_at: now()
    },
    prefer: "return=representation"
  });
}

export async function retryCatalogResearchJob(job, { code = "source-unavailable", message = "Research source is temporarily unavailable.", source = "catalog-research", result = {} } = {}) {
  const attempts = Number(job.attempt_count || 0);
  const exhausted = attempts >= Number(job.max_attempts || 5);
  const retryAt = new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString();
  return supabaseFetch(`catalog_research_jobs?id=eq.${encodeURIComponent(job.id)}`, {
    method: "PATCH",
    service: true,
    body: {
      status: exhausted ? "failed" : "retry",
      stage: exhausted ? "complete" : "queued",
      completed_at: exhausted ? now() : null,
      next_retry_at: exhausted ? now() : retryAt,
      last_error_code: code,
      last_error_message: String(message || "").slice(0, 1200),
      last_error_source: source,
      result: { ...(job.result || {}), ...result },
      updated_at: now()
    },
    prefer: "return=representation"
  });
}

export async function markCatalogResearchJobsDeploymentPending(skus = [], deployment = {}) {
  const targets = [...new Set((skus || []).map(normalizedSku).filter(Boolean))];
  if (!targets.length) return [];
  return supabaseFetch(`catalog_research_jobs?sku=in.(${quoteList(targets)})&status=in.(ready,deployment_pending)`, {
    method: "PATCH",
    service: true,
    body: { status: "deployment_pending", stage: "deployment", result: { deployment }, next_retry_at: now(), updated_at: now() },
    prefer: "return=representation"
  });
}

export async function markCatalogResearchJobsLive(skus = [], deployment = {}) {
  const targets = [...new Set((skus || []).map(normalizedSku).filter(Boolean))];
  if (!targets.length) return [];
  return supabaseFetch(`catalog_research_jobs?sku=in.(${quoteList(targets)})&status=in.(ready,deployment_pending)`, {
    method: "PATCH",
    service: true,
    body: {
      status: "live",
      stage: "complete",
      completed_at: now(),
      result: { deployment },
      next_retry_at: now(),
      updated_at: now()
    },
    prefer: "return=representation"
  });
}

export async function catalogResearchJobSummary(skus = []) {
  const targets = [...new Set((skus || []).map(normalizedSku).filter(Boolean))];
  const filter = targets.length ? `&sku=in.(${quoteList(targets)})` : "";
  const rows = await supabaseFetch(`catalog_research_jobs?select=*&order=updated_at.desc&limit=100${filter}`, { service: true });
  return rows || [];
}

export { ACTIVE_STATUSES };

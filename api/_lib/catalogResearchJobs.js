import { inventoryFingerprint, RELATED_ARTIST_RESEARCH_VERSION } from "./catalogEnrichment.js";
import { supabaseFetch } from "./supabase.js";

const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const ACTIVE_STATUSES = new Set(["queued", "processing", "retry", "ready", "deployment_pending"]);
const RESEARCH_LEASE_MS = 2 * 60 * 1000;

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
          lease_expires_at: null,
          worker_id: null,
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
  await recoverExpiredCatalogResearchJobs({ skus: targets });
  const nowValue = encodeURIComponent(now());
  const filter = targets.length ? `&sku=in.(${quoteList(targets)})` : "";
  const rows = await supabaseFetch(
    `catalog_research_jobs?select=*&status=in.(queued,retry)&next_retry_at=lte.${nowValue}${filter}&order=created_at.asc&limit=${safeLimit * 3}`,
    { service: true }
  );
  const claimed = [];
  const workerId = `catalog-worker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  for (const row of rows || []) {
    if (claimed.length >= safeLimit) break;
    const previousStatus = String(row.status || "");
    const updates = {
      status: "processing",
      stage: "matching_release",
      started_at: now(),
      attempt_count: Number(row.attempt_count || 0) + 1,
      lease_expires_at: new Date(Date.now() + RESEARCH_LEASE_MS).toISOString(),
      worker_id: workerId,
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

export async function recoverExpiredCatalogResearchJobs({ skus = [] } = {}) {
  const targets = [...new Set((skus || []).map(normalizedSku).filter(Boolean))];
  const filter = targets.length ? `&sku=in.(${quoteList(targets)})` : "";
  return supabaseFetch(
    `catalog_research_jobs?status=eq.processing&lease_expires_at=lt.${encodeURIComponent(now())}${filter}`,
    {
      method: "PATCH",
      service: true,
      body: {
        status: "retry",
        stage: "queued",
        next_retry_at: now(),
        lease_expires_at: null,
        worker_id: null,
        last_error_code: "worker-lease-expired",
        last_error_message: "The previous research worker ended before completing the job; the job was safely returned to the queue.",
        last_error_source: "catalog-research-worker",
        updated_at: now()
      },
      prefer: "return=representation"
    }
  );
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
      lease_expires_at: null,
      worker_id: null,
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
      lease_expires_at: null,
      worker_id: null,
      result: { ...(job.result || {}), ...result },
      updated_at: now()
    },
    prefer: "return=representation"
  });
}

function publicationJobTargets(jobs = []) {
  const targets = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const id = String(job?.id || "").trim();
    const requestFingerprint = String(job?.request_fingerprint || job?.requestFingerprint || "").trim();
    if (!id || !requestFingerprint) continue;
    targets.set(`${id}:${requestFingerprint}`, { id, requestFingerprint });
  }
  return [...targets.values()];
}

export function publicationJobsForProducts(jobs = [], products = []) {
  const productBySku = new Map(
    (Array.isArray(products) ? products : []).map((product) => [normalizedSku(product?.sku), product])
  );
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    const product = productBySku.get(normalizedSku(job?.sku));
    if (!product || product.publishStatus !== "Published" || product.visibility !== "Public") return false;
    const fingerprint = String(product.raw?.enrichmentFingerprint || product.enrichmentFingerprint || "").trim();
    return Boolean(fingerprint && fingerprint === String(job?.request_fingerprint || "").trim());
  });
}

export async function markCatalogResearchJobsDeploymentPending(jobs = [], deployment = {}) {
  const targets = publicationJobTargets(jobs);
  if (!targets.length) return [];
  const rows = await Promise.all(targets.map((target) => supabaseFetch(
    `catalog_research_jobs?id=eq.${encodeURIComponent(target.id)}&request_fingerprint=eq.${encodeURIComponent(target.requestFingerprint)}&status=in.(ready,deployment_pending)`,
    {
      method: "PATCH",
      service: true,
      body: { status: "deployment_pending", stage: "deployment", result: { deployment }, next_retry_at: now(), lease_expires_at: null, worker_id: null, updated_at: now() },
      prefer: "return=representation"
    }
  )));
  return rows.flat();
}

export async function markCatalogResearchJobsLive(jobs = [], deployment = {}) {
  const targets = publicationJobTargets(jobs);
  if (!targets.length) return [];
  const rows = await Promise.all(targets.map((target) => supabaseFetch(
    `catalog_research_jobs?id=eq.${encodeURIComponent(target.id)}&request_fingerprint=eq.${encodeURIComponent(target.requestFingerprint)}&status=in.(ready,deployment_pending)`,
    {
      method: "PATCH",
      service: true,
      body: {
        status: "live",
        stage: "complete",
        completed_at: now(),
        result: { deployment },
        next_retry_at: now(),
        lease_expires_at: null,
        worker_id: null,
        updated_at: now()
      },
      prefer: "return=representation"
    }
  )));
  return rows.flat();
}

export async function catalogResearchJobSummary(skus = [], { statuses = [], limit = 1000 } = {}) {
  const targets = [...new Set((skus || []).map(normalizedSku).filter(Boolean))];
  const filter = targets.length ? `&sku=in.(${quoteList(targets)})` : "";
  const statusFilter = statuses.length ? `&status=in.(${statuses.map(String).join(",")})` : "";
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 1000));
  const rows = await supabaseFetch(`catalog_research_jobs?select=*&order=updated_at.desc&limit=${safeLimit}${filter}${statusFilter}`, { service: true });
  return rows || [];
}

export { ACTIVE_STATUSES };

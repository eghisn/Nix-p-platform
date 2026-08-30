import { fromProductRow, supabaseFetch } from "./supabase.js";
import { syncAdminProductInventory } from "./financeState.js";

const ACTIVE_STATUSES = new Set(["queued", "processing", "retry"]);
const LEASE_MS = 2 * 60 * 1000;

function now() {
  return new Date().toISOString();
}

function jobId(productId, revision) {
  return `admin-finance-sync-${String(productId || "product").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-r${revision}`;
}

function retryDelaySeconds(attemptCount = 1) {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, Number(attemptCount || 1) - 1)));
}

function statusSummary(result = {}) {
  return {
    jobId: result.id || "",
    status: result.status || "queued",
    synced: result.status === "synced",
    pending: ACTIVE_STATUSES.has(result.status),
    message: result.message || ""
  };
}

export async function enqueueAdminFinanceSyncJob(product = {}) {
  const productId = String(product?.id || "").trim();
  const productRevision = Math.max(1, Number(product?.editRevision) || 1);
  const sku = String(product?.sku || "").trim();
  if (!productId || !sku) throw new Error("Finance sync queue requires a saved product ID and SKU.");
  const job = {
    id: jobId(productId, productRevision),
    product_id: productId,
    product_revision: productRevision,
    sku,
    status: "queued",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: now(),
    lease_expires_at: null,
    worker_id: null,
    last_error_message: null,
    created_at: now(),
    updated_at: now()
  };
  await supabaseFetch("admin_finance_sync_jobs?on_conflict=product_id,product_revision", {
    method: "POST",
    service: true,
    body: [job],
    prefer: "resolution=ignore-duplicates,return=minimal"
  });
  const rows = await supabaseFetch(
    `admin_finance_sync_jobs?select=*&product_id=eq.${encodeURIComponent(productId)}&product_revision=eq.${productRevision}&limit=1`,
    { service: true }
  );
  return rows?.[0] || job;
}

export async function recoverExpiredAdminFinanceSyncJobs({ productId = "" } = {}) {
  const filter = productId ? `&product_id=eq.${encodeURIComponent(productId)}` : "";
  return supabaseFetch(
    `admin_finance_sync_jobs?status=eq.processing&lease_expires_at=lt.${encodeURIComponent(now())}${filter}`,
    {
      method: "PATCH",
      service: true,
      body: {
        status: "retry",
        next_retry_at: now(),
        lease_expires_at: null,
        worker_id: null,
        last_error_message: "The previous Finance sync worker ended before completing. The sync was safely returned to the queue.",
        updated_at: now()
      },
      prefer: "return=representation"
    }
  );
}

async function claimAdminFinanceSyncJobs({ limit = 1, productId = "" } = {}) {
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 1));
  await recoverExpiredAdminFinanceSyncJobs({ productId });
  const filter = productId ? `&product_id=eq.${encodeURIComponent(productId)}` : "";
  const rows = await supabaseFetch(
    `admin_finance_sync_jobs?select=*&status=in.(queued,retry)&next_retry_at=lte.${encodeURIComponent(now())}${filter}&order=created_at.asc&limit=${safeLimit * 3}`,
    { service: true }
  );
  const workerId = `admin-finance-sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const claimed = [];
  for (const row of rows || []) {
    if (claimed.length >= safeLimit) break;
    const updated = await supabaseFetch(
      `admin_finance_sync_jobs?id=eq.${encodeURIComponent(row.id)}&status=eq.${encodeURIComponent(row.status)}`,
      {
        method: "PATCH",
        service: true,
        body: {
          status: "processing",
          attempt_count: Number(row.attempt_count || 0) + 1,
          lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
          worker_id: workerId,
          updated_at: now()
        },
        prefer: "return=representation"
      }
    );
    if (updated?.[0]) claimed.push(updated[0]);
  }
  return claimed;
}

async function updateJob(job, update) {
  const workerFilter = String(job.worker_id || "").trim()
    ? `&worker_id=eq.${encodeURIComponent(job.worker_id)}`
    : "";
  const rows = await supabaseFetch(`admin_finance_sync_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.processing${workerFilter}`, {
    method: "PATCH",
    service: true,
    body: { ...update, lease_expires_at: null, worker_id: null, updated_at: now() },
    prefer: "return=representation"
  });
  return rows?.[0] || null;
}

export async function processAdminFinanceSyncJobs({ limit = 4, productId = "" } = {}) {
  const jobs = await claimAdminFinanceSyncJobs({ limit, productId });
  const results = [];
  for (const job of jobs) {
    try {
      const rows = await supabaseFetch(`products?select=*&id=eq.${encodeURIComponent(job.product_id)}&limit=1`, { service: true });
      const row = rows?.[0] || null;
      if (!row) {
        const cancelled = await updateJob(job, {
          status: "cancelled",
          completed_at: now(),
          last_error_message: "Product no longer exists; Finance sync is no longer needed."
        });
        results.push(cancelled
          ? { ...statusSummary(cancelled), message: cancelled.last_error_message }
          : { jobId: job.id, status: "superseded", synced: false, pending: true, message: "Finance sync lease moved to a newer worker." });
        continue;
      }
      if (Math.max(1, Number(row.edit_revision) || 1) !== Number(job.product_revision)) {
        const successor = await enqueueAdminFinanceSyncJob(fromProductRow(row, { privateScope: true }));
        const cancelled = await updateJob(job, {
          status: "cancelled",
          completed_at: now(),
          last_error_message: `A newer product revision replaced this sync request and was queued as ${successor.id}.`
        });
        results.push({
          jobId: successor.id,
          status: "queued",
          synced: false,
          pending: true,
          message: cancelled?.last_error_message || "A newer product revision was queued for Finance synchronization."
        });
        continue;
      }
      await syncAdminProductInventory(fromProductRow(row, { privateScope: true }));
      const synced = await updateJob(job, {
        status: "synced",
        completed_at: now(),
        last_error_message: null
      });
      results.push(synced
        ? statusSummary(synced)
        : { jobId: job.id, status: "superseded", synced: false, pending: true, message: "Finance sync lease moved to a newer worker." });
    } catch (error) {
      const attempts = Number(job.attempt_count || 0);
      const exhausted = attempts >= Number(job.max_attempts || 5);
      const message = error instanceof Error ? error.message : "Finance inventory sync failed.";
      const retried = await updateJob(job, {
        status: exhausted ? "failed" : "retry",
        completed_at: exhausted ? now() : null,
        next_retry_at: exhausted ? now() : new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString(),
        last_error_message: String(message).slice(0, 1200)
      });
      results.push(retried
        ? { ...statusSummary(retried), message: retried.last_error_message || message }
        : { jobId: job.id, status: "superseded", synced: false, pending: true, message: "Finance sync lease moved to a newer worker." });
    }
  }
  return {
    processed: results.length,
    synced: results.filter((result) => result.synced).length,
    pending: results.filter((result) => result.pending).length,
    failed: results.filter((result) => result.status === "failed").length,
    results
  };
}

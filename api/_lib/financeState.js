import {
  RELATED_ARTIST_RESEARCH_VERSION,
  enrichFinanceCatalogProduct,
  inventoryFingerprint,
  isEditorialDescriptionQuality,
  isExplicitManualRelatedArtistsOverride,
  normalizeRelatedArtistsPayload,
  researchRelatedArtists
} from "./catalogEnrichment.js";
import { artistCreditNames, productArtistCreditNames, canonicalArtistName, canonicalLabelName, canonicalProductArtist } from "../../src/data/catalogIdentity.js";
import { catalogPublicationIssues, isResearchPublicationReady, isRecordPublicationReady } from "../../src/data/catalogPublication.js";
import { referenceShippingProfile } from "../../src/data/shippingProfiles.js";

const STATE_KEY = "main";
const FINANCE_SECTIONS = ["general", "sales", "expenses", "inventory", "inventoryStock", "monthlyReports", "openingCash", "targets"];
const EMPTY_FINANCE_STATE = {
  general: [],
  sales: [],
  expenses: [],
  inventory: [],
  inventoryStock: [],
  monthlyReports: [],
  openingCash: null,
  targets: {}
};
const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const APPAREL_TYPES = new Set(["T-shirt", "Longsleeve", "Crewneck", "Hoodie", "Jacket", "Shirt", "Cap"]);
const FINANCE_CATALOG_SYNC_LEASE_MS = 2 * 60 * 1000;
const FINANCE_CATALOG_SYNC_MAX_ATTEMPTS = 5;

export function isFinanceState(value) {
  return (
    value &&
    Array.isArray(value.general) &&
    Array.isArray(value.sales) &&
    Array.isArray(value.expenses) &&
    Array.isArray(value.inventory)
  );
}

export async function readFinanceState() {
  return (await readFinanceStateWithVersion()).state;
}

export async function readFinanceStateWithVersion() {
  const sections = await readRemoteSectionsWithVersion().catch((error) => {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) throw error;
    return null;
  });
  if (sections && isFinanceState(sections.state)) {
    return sections;
  }
  const remote = await readLegacyStateWithVersion().catch((error) => {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) throw error;
    return null;
  });
  if (isFinanceState(remote?.state)) {
    return { state: normalizeFinanceState(remote.state), updatedAt: remote.updatedAt || null, sectionVersions: {} };
  }
  return { state: normalizeFinanceState(EMPTY_FINANCE_STATE), updatedAt: null, sectionVersions: {} };
}

export async function writeFinanceState(state, { syncCatalog = true, expectedUpdatedAt = null, expectedSectionVersions = null, changedSections = null } = {}) {
  if (!isFinanceState(state)) throw new Error("Invalid finance state.");
  const normalized = normalizeFinanceState(state);
  const previous = await readFinanceStateWithVersion();
  if (expectedUpdatedAt && !expectedSectionVersions && expectedUpdatedAt !== previous.updatedAt) {
    const error = new Error("Finance data changed on the server. Reload before saving again.");
    error.statusCode = 409;
    throw error;
  }
  const changes = changedFinanceSections(previous.state, normalized, changedSections);
  if (Object.keys(changes).length) {
    try {
      await supabaseFetch("rpc/write_finance_state_sections", {
        method: "POST",
        body: {
          p_changes: changes,
          p_expected_revisions: expectedSectionVersions || previous.sectionVersions || {}
        },
        prefer: "return=minimal"
      });
    } catch (error) {
      if (String(error?.message || "").includes("FINANCE_SECTION_CONFLICT")) error.statusCode = 409;
      throw error;
    }
  }
  const saved = await readFinanceStateWithVersion();
  const backupId = Object.keys(changes).length
    ? await backupFinanceState(previous.state, saved.state, changes).catch(() => null)
    : null;
  // Finance is committed before catalog work begins. A durable, SKU-scoped job
  // keeps a transient catalog failure from making a saved transaction look lost.
  const catalogSync = syncCatalog
    ? await queueFinanceCatalogSync(previous.state, saved.state, changes)
    : { status: "not_needed", synced: false, pending: false, message: "Catalog synchronization was intentionally skipped." };
  return { ...saved, backupId, catalogSync };
}

// Finance is the source of truth for SKU stock. Complete record entries pass
// through catalog enrichment before publication; ambiguous editions remain
// visible in Admin with a precise enrichment status.
export async function syncFinanceInventoryToCatalog(
  state,
  {
    enrich = true,
    forceEnrichment = false,
    targetSkus = [],
    publishAfterResearch = false,
    syncSkus = null,
    syncInventoryIds = [],
    fullInventorySync = false
  } = {}
) {
  const allStockRows = (state.inventoryStock || []).filter((item) => String(item?.sku || "").trim());
  const syncSkuKeys = new Set((syncSkus || []).map((sku) => String(sku || "").trim().toLowerCase()).filter(Boolean));
  const syncInventoryIdSet = new Set((syncInventoryIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const scopedSync = !fullInventorySync && (syncSkuKeys.size > 0 || syncInventoryIdSet.size > 0);
  const stockRows = scopedSync
    ? allStockRows.filter((item) => syncSkuKeys.has(String(item?.sku || "").trim().toLowerCase()))
    : allStockRows;
  const purchaseRows = scopedSync
    ? (state.inventory || []).filter((item) => {
      const sku = String(item?.sku || "").trim().toLowerCase();
      return syncSkuKeys.has(sku) || syncInventoryIdSet.has(String(item?.id || "").trim());
    })
    : (state.inventory || []);
  const enrichmentTargets = new Set((targetSkus || []).map((sku) => String(sku || "").trim().toLowerCase()).filter(Boolean));
  const skus = [...new Set([
    ...stockRows.map((item) => String(item.sku).trim()),
    ...purchaseRows.map((item) => String(item?.sku || "").trim()),
    ...(syncSkus || []).map((sku) => String(sku || "").trim())
  ].filter(Boolean))];
  const [existingRows, catalogArtistRows] = await Promise.all([
    skus.length ? supabaseFetch(`products?select=*&sku=in.(${skuList(skus)})`) : [],
    enrich
      ? supabaseFetch("products?select=artist,label,tags,raw,category,publish_status,visibility&category=eq.Records&publish_status=eq.Published&visibility=eq.Public")
      : Promise.resolve([])
  ]);
  const existingBySku = new Map(existingRows.map((row) => [String(row.sku || "").trim().toLowerCase(), row]));
  const productRows = [];
  const operationalUpdates = [];
  const productIdBySku = new Map(existingRows.map((row) => [String(row.sku || "").trim().toLowerCase(), row.id]));

  for (const stock of stockRows) {
    const sku = String(stock.sku).trim();
    const key = sku.toLowerCase();
    const existing = existingBySku.get(key);
    const quantity = normalizedQuantity(stock.qty);
    if (existing) {
      const financeProduct = productRowFromFinanceStock(existing, stock, quantity);
      const targetSelected = !enrichmentTargets.size || enrichmentTargets.has(key);
      const shouldEnrich = enrich && targetSelected && (forceEnrichment || needsFinanceEnrichment(existing, stock));
      if (!shouldEnrich) {
        operationalUpdates.push({
          id: existing.id,
          price: openToOffersPrice(stock),
          openToOffers: stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true,
          minimumAcceptableOffer: wholeAmount(stock.minimumAcceptableOffer),
          updatedAt: today()
        });
        productIdBySku.set(key, existing.id);
        continue;
      }
      const enrichedProduct = shouldEnrich
          ? await enrichFinanceCatalogProduct(financeProduct, stock, { catalogArtists: catalogArtistRows })
          : financeProduct;
      const resolvedProduct = publishAfterResearch && targetSelected
        ? allowResearchPublication(enrichedProduct)
        : enrichedProduct;
      productRows.push(
        withSyncAudit(resolvedProduct, {
          source: "Finance",
          action: "Inventory synchronized to catalog",
          sku,
          quantity
        })
      );
      productIdBySku.set(key, existing.id);
      continue;
    }
    const product = draftProductFromFinanceStock(stock, quantity);
    const targetSelected = !enrichmentTargets.size || enrichmentTargets.has(key);
    const enrichedProduct = enrich && targetSelected
      ? await enrichFinanceCatalogProduct(product, stock, { catalogArtists: catalogArtistRows })
      : product;
    productRows.push(
      withSyncAudit(publishAfterResearch && targetSelected ? allowResearchPublication(enrichedProduct) : enrichedProduct, {
        source: "Finance",
        action: "Inventory created catalog item",
        sku,
        quantity
      })
    );
    productIdBySku.set(key, product.id);
  }

  const uniqueProductRows = dedupeRows(productRows);
  // A finance save can overlap a catalog research request. Re-read the catalog
  // immediately before writing so an older finance snapshot cannot erase an
  // already-completed cover, review, or publication state.
  const latestCatalogRows = uniqueProductRows.length
    ? await supabaseFetch(`products?select=*&id=in.(${skuList(uniqueProductRows.map((row) => row.id))})`)
    : [];
  const latestById = new Map(latestCatalogRows.map((row) => [String(row.id), row]));
  const stockBySku = new Map(stockRows.map((stock) => [String(stock.sku || "").trim().toLowerCase(), stock]));
  const protectedProductRows = uniqueProductRows.map((row) =>
    preserveCompletedCatalogData(latestById.get(String(row.id)), row, stockBySku.get(String(row.sku || "").trim().toLowerCase()))
  );
  for (const row of protectedProductRows) {
    const latest = latestById.get(String(row.id));
    if (!latest) {
      await supabaseFetch("products?on_conflict=id", {
        method: "POST",
        body: [row],
        prefer: "resolution=ignore-duplicates,return=minimal"
      });
      continue;
    }
    const revision = Math.max(1, Number(latest.edit_revision) || 1);
    const saved = await supabaseFetch(
      `products?id=eq.${encodeURIComponent(row.id)}&edit_revision=eq.${revision}`,
      {
        method: "PATCH",
        body: row,
        prefer: "return=representation"
      }
    );
    if (!saved?.[0]) {
      const error = new Error("Admin edited this product while catalog research was running. Research will retry without overwriting the manual edit.");
      error.code = "admin-edit-conflict";
      throw error;
    }
  }
  if (operationalUpdates.length) {
    await supabaseFetch("rpc/sync_finance_catalog_operational", {
      method: "POST",
      body: { p_updates: operationalUpdates },
      prefer: "return=minimal"
    });
  }

  const inventoryRows = [
    ...purchaseRows.map((item) => financeInventoryRow(item, productIdBySku)),
    ...stockRows.map((item) => financeStockRow(item, productIdBySku))
  ];
  const uniqueInventoryRows = dedupeRows(inventoryRows);
  await deleteStaleFinanceInventoryRows(uniqueInventoryRows.map((row) => row.id), {
    fullSync: !scopedSync,
    targetSkuKeys: syncSkuKeys,
    targetInventoryIds: syncInventoryIdSet
  });
  if (uniqueInventoryRows.length) {
    await supabaseFetch("inventory?on_conflict=id", {
      method: "POST",
      body: uniqueInventoryRows,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }
  await syncFinanceArtistsToCatalog(protectedProductRows);
  // Stock availability is calculated in Postgres from Finance quantity minus
  // live reservations. Never write the Finance quantity directly onto an
  // existing catalog product here: that could revive stock during checkout.
  if (skus.length) await reconcileFinanceStockToCatalog(skus);
}

export async function reconcileFinanceStockToCatalog(skus = []) {
  const targetSkus = [...new Set((skus || [])
    .map((sku) => String(sku || "").trim())
    .filter(Boolean))];
  return supabaseFetch("rpc/reconcile_finance_stock_to_catalog", {
    method: "POST",
    body: { p_skus: targetSkus.length ? targetSkus : null }
  });
}

export function financeCatalogSyncRequest(previousState, nextState, changes = {}) {
  const touchesInventory = Object.prototype.hasOwnProperty.call(changes, "inventory") ||
    Object.prototype.hasOwnProperty.call(changes, "inventoryStock");
  if (!touchesInventory) return null;
  const targetSkus = new Set();
  const targetInventoryIds = new Set();
  const addInventoryItem = (item) => {
    if (!item) return;
    const sku = String(item?.sku || "").trim();
    if (sku) targetSkus.add(sku);
    if (item?.id) targetInventoryIds.add(String(item.id));
  };
  const addStockItem = (item) => {
    const sku = String(item?.sku || "").trim();
    if (sku) targetSkus.add(sku);
  };
  if (Object.prototype.hasOwnProperty.call(changes, "inventory")) {
    for (const item of changedFinanceRows(previousState?.inventory, nextState?.inventory)) addInventoryItem(item);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "inventoryStock")) {
    for (const item of changedFinanceRows(previousState?.inventoryStock, nextState?.inventoryStock)) addStockItem(item);
  }
  // Rows without an SKU (for example, a non-catalog operational note) have no
  // corresponding storefront row. Never let one turn a normal Finance save
  // into a full-catalog synchronization.
  if (targetSkus.size === 0 && targetInventoryIds.size === 0) return null;
  return {
    targetSkus: [...targetSkus],
    targetInventoryIds: [...targetInventoryIds],
    changedSections: Object.keys(changes),
    fullInventorySync: false
  };
}

function changedFinanceRows(previousRows = [], nextRows = []) {
  const previousByKey = new Map((Array.isArray(previousRows) ? previousRows : [])
    .map((item, index) => [String(item?.id || item?.sku || `previous-${index}`), item]));
  const nextByKey = new Map((Array.isArray(nextRows) ? nextRows : [])
    .map((item, index) => [String(item?.id || item?.sku || `next-${index}`), item]));
  const rows = [];
  for (const key of new Set([...previousByKey.keys(), ...nextByKey.keys()])) {
    const previous = previousByKey.get(key);
    const next = nextByKey.get(key);
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    if (previous) rows.push(previous);
    if (next) rows.push(next);
  }
  return rows;
}

function financeCatalogSyncJobId() {
  return `finance-catalog-sync-${new Date().toISOString().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
}

function financeCatalogRetryDelaySeconds(attempt) {
  return Math.min(15 * 60, 30 * (2 ** Math.max(0, Number(attempt || 1) - 1)));
}

function financeCatalogSyncSummary(job, message = "") {
  const status = String(job?.status || "queued");
  return {
    jobId: job?.id || null,
    status,
    synced: status === "synced",
    pending: ["queued", "processing", "retry"].includes(status),
    message: message || job?.last_error_message || ""
  };
}

async function enqueueFinanceCatalogSyncJob(request) {
  const job = {
    id: financeCatalogSyncJobId(),
    status: "queued",
    target_skus: request.targetSkus || [],
    target_inventory_ids: request.targetInventoryIds || [],
    changed_sections: request.changedSections || [],
    full_inventory_sync: request.fullInventorySync === true,
    attempt_count: 0,
    max_attempts: FINANCE_CATALOG_SYNC_MAX_ATTEMPTS,
    next_retry_at: new Date().toISOString(),
    lease_expires_at: null,
    worker_id: null,
    last_error_message: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await supabaseFetch("finance_catalog_sync_jobs", {
    method: "POST",
    body: [job],
    prefer: "return=representation"
  });
  return job;
}

async function recoverExpiredFinanceCatalogSyncJobs({ jobId = "" } = {}) {
  const jobFilter = jobId ? `&id=eq.${encodeURIComponent(jobId)}` : "";
  return supabaseFetch(
    `finance_catalog_sync_jobs?status=eq.processing&lease_expires_at=lt.${encodeURIComponent(new Date().toISOString())}${jobFilter}`,
    {
      method: "PATCH",
      body: {
        status: "retry",
        next_retry_at: new Date().toISOString(),
        lease_expires_at: null,
        worker_id: null,
        last_error_message: "The previous catalog sync worker ended before completing. The saved Finance change remains queued for a safe retry.",
        updated_at: new Date().toISOString()
      },
      prefer: "return=representation"
    }
  );
}

async function claimFinanceCatalogSyncJobs({ limit = 1, jobId = "" } = {}) {
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 1));
  await recoverExpiredFinanceCatalogSyncJobs({ jobId });
  const jobFilter = jobId ? `&id=eq.${encodeURIComponent(jobId)}` : "";
  const rows = await supabaseFetch(
    `finance_catalog_sync_jobs?select=*&status=in.(queued,retry)&next_retry_at=lte.${encodeURIComponent(new Date().toISOString())}${jobFilter}&order=created_at.asc&limit=${safeLimit * 3}`
  );
  const workerId = `finance-catalog-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const claimed = [];
  for (const row of rows || []) {
    if (claimed.length >= safeLimit) break;
    const updated = await supabaseFetch(
      `finance_catalog_sync_jobs?id=eq.${encodeURIComponent(row.id)}&status=eq.${encodeURIComponent(row.status)}`,
      {
        method: "PATCH",
        body: {
          status: "processing",
          attempt_count: Number(row.attempt_count || 0) + 1,
          lease_expires_at: new Date(Date.now() + FINANCE_CATALOG_SYNC_LEASE_MS).toISOString(),
          worker_id: workerId,
          updated_at: new Date().toISOString()
        },
        prefer: "return=representation"
      }
    );
    if (updated?.[0]) claimed.push(updated[0]);
  }
  return claimed;
}

async function updateFinanceCatalogSyncJob(job, update) {
  const workerFilter = String(job?.worker_id || "").trim()
    ? `&worker_id=eq.${encodeURIComponent(job.worker_id)}`
    : "";
  const rows = await supabaseFetch(
    `finance_catalog_sync_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.processing${workerFilter}`,
    {
      method: "PATCH",
      body: { ...update, lease_expires_at: null, worker_id: null, updated_at: new Date().toISOString() },
      prefer: "return=representation"
    }
  );
  return rows?.[0] || null;
}

export async function processFinanceCatalogSyncJobs({ limit = 2, jobId = "" } = {}) {
  const jobs = await claimFinanceCatalogSyncJobs({ limit, jobId });
  const results = [];
  for (const job of jobs) {
    try {
      const state = await readFinanceState();
      await syncFinanceInventoryToCatalog(state, {
        enrich: false,
        syncSkus: Array.isArray(job.target_skus) ? job.target_skus : [],
        syncInventoryIds: Array.isArray(job.target_inventory_ids) ? job.target_inventory_ids : [],
        fullInventorySync: job.full_inventory_sync === true
      });
      const synced = await updateFinanceCatalogSyncJob(job, {
        status: "synced",
        completed_at: new Date().toISOString(),
        last_error_message: null
      });
      results.push(synced
        ? financeCatalogSyncSummary(synced, "Catalog inventory synchronized.")
        : { jobId: job.id, status: "superseded", synced: false, pending: true, message: "Catalog sync lease moved to a newer worker." });
    } catch (error) {
      const attempts = Number(job.attempt_count || 0);
      const exhausted = attempts >= Number(job.max_attempts || FINANCE_CATALOG_SYNC_MAX_ATTEMPTS);
      const message = error instanceof Error ? error.message : "Finance catalog synchronization failed.";
      const updated = await updateFinanceCatalogSyncJob(job, {
        status: exhausted ? "failed" : "retry",
        completed_at: exhausted ? new Date().toISOString() : null,
        next_retry_at: exhausted
          ? new Date().toISOString()
          : new Date(Date.now() + financeCatalogRetryDelaySeconds(attempts) * 1000).toISOString(),
        last_error_message: String(message).slice(0, 1200)
      });
      results.push(updated
        ? financeCatalogSyncSummary(updated, updated.last_error_message || message)
        : { jobId: job.id, status: "superseded", synced: false, pending: true, message: "Catalog sync lease moved to a newer worker." });
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

async function queueFinanceCatalogSync(previousState, nextState, changes) {
  const request = financeCatalogSyncRequest(previousState, nextState, changes);
  if (!request) {
    return { status: "not_needed", synced: false, pending: false, message: "No inventory fields changed, so catalog synchronization was not needed." };
  }
  try {
    const job = await enqueueFinanceCatalogSyncJob(request);
    const processed = await processFinanceCatalogSyncJobs({ limit: 1, jobId: job.id });
    return processed.results.find((result) => result.jobId === job.id) ||
      financeCatalogSyncSummary(job, "Catalog inventory synchronization is queued for retry.");
  } catch (error) {
    return {
      status: "needs_attention",
      synced: false,
      pending: false,
      message: `Finance was saved, but catalog sync could not be queued: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

// Server-side, resumable catalog research. A job is claimed in Supabase before
// external calls begin, so a browser refresh or function timeout cannot make
// Finance data disappear or leave Admin guessing whether work was saved.
export async function processCatalogResearchJobs({ limit = 1, skus = [], force = false, publishAfterResearch = false, requestedBy = "admin" } = {}) {
  const jobsApi = await import("./catalogResearchJobs.js");
  const state = await readFinanceState();
  if (force || skus.length) {
    await jobsApi.enqueueCatalogResearchJobs(state.inventoryStock || [], { requestedBy, force, skus });
  }
  const jobs = await jobsApi.claimCatalogResearchJobs({ limit, skus });
  const stockBySku = new Map((state.inventoryStock || []).map((item) => [String(item?.sku || "").trim().toUpperCase(), item]));
  const results = [];
  for (const job of jobs) {
    const stock = stockBySku.get(String(job.sku || "").trim().toUpperCase());
    if (!stock) {
      await jobsApi.completeCatalogResearchJob(job, { status: "cancelled", stage: "complete", result: { reason: "SKU no longer exists in Finance inventory." } });
      results.push({ sku: job.sku, status: "cancelled", issues: ["SKU no longer exists in Finance inventory."] });
      continue;
    }
    try {
      await syncFinanceInventoryToCatalog(state, {
        enrich: true,
        forceEnrichment: true,
        targetSkus: [job.sku],
        publishAfterResearch
      });
      const rows = await supabaseFetch(`products?select=*&sku=eq.${encodeURIComponent(job.sku)}&limit=1`);
      const product = rows?.[0] || null;
      const issues = product ? catalogPublicationIssues(product) : ["Catalog product was not written after research."];
      const ready = Boolean(product && isResearchPublicationReady(product));
      if (ready) {
        await jobsApi.completeCatalogResearchJob(job, {
          status: publishAfterResearch ? "deployment_pending" : "ready",
          stage: publishAfterResearch ? "deployment" : "validating",
          result: { productId: product.id, issues: [], publishRequested: publishAfterResearch }
        });
        results.push({ sku: job.sku, id: product.id, status: publishAfterResearch ? "deployment_pending" : "ready", issues: [] });
      } else {
        const status = String(product?.raw?.enrichmentStatus || "needs-release-match");
        const result = { productId: product?.id || null, issues };
        if (["needs-finance-data", "needs-pressing-identifier"].includes(status)) {
          // These states need a human correction in Finance, so retries only
          // repeat the same work and make the queue look unreliable.
          await jobsApi.completeCatalogResearchJob(job, {
            status: "failed",
            stage: "complete",
            result: { ...result, reason: status }
          });
          results.push({ sku: job.sku, id: product?.id || null, status: "needs-input", issues });
        } else {
          await jobsApi.retryCatalogResearchJob(job, {
            code: status,
            message: issues.join("; ") || "Exact release research is incomplete.",
            source: "catalog-enrichment",
            result
          });
          results.push({ sku: job.sku, id: product?.id || null, status: "retry", issues });
        }
      }
    } catch (error) {
      await jobsApi.retryCatalogResearchJob(job, {
        code: error?.code || "research-runtime-failed",
        message: error instanceof Error ? error.message : "Catalog research failed.",
        source: error?.code === "admin-edit-conflict" ? "admin-revision-guard" : "catalog-enrichment"
      });
      results.push({ sku: job.sku, status: "retry", issues: [error instanceof Error ? error.message : "Catalog research failed."] });
    }
  }
  return { queued: jobs.length, processed: results.length, results };
}

function preserveCompletedCatalogData(latest, next, stock = {}) {
  if (!latest || !next || next.category !== "Records") return next;
  if (Number(latest.edit_revision || 1) > Number(next.edit_revision || 1)) {
    return {
      ...latest,
      price: next.price,
      open_to_offers: next.open_to_offers,
      minimum_acceptable_offer: next.minimum_acceptable_offer,
      updated_at: next.updated_at,
      raw: {
        ...(latest.raw || {}),
        price: next.price,
        open_to_offers: next.open_to_offers,
        minimumAcceptableOffer: next.minimum_acceptable_offer,
        updatedAt: next.updated_at
      }
    };
  }
  const fingerprint = inventoryFingerprint(stock);
  const sameRelease = String(latest.raw?.enrichmentFingerprint || "") === fingerprint;
  const latestIsComplete = hasCompletedCatalogData(latest);
  const nextIsIncomplete = !hasCompletedCatalogData(next);
  if (!sameRelease || !latestIsComplete || !nextIsIncomplete) return next;

  const latestRaw = latest.raw || {};
  const nextRaw = next.raw || {};
  const preservedRaw = {
    ...latestRaw,
    ...nextRaw,
    // Keep finance-owned values from the current save while retaining the
    // verified editorial fields that a stale snapshot does not contain.
    autoCover: latestRaw.autoCover,
    autoProductPhoto: latestRaw.autoProductPhoto,
    autoEditorial: latestRaw.autoEditorial,
    relatedArtists: latestRaw.relatedArtists,
    manualRelatedArtists: latestRaw.manualRelatedArtists,
    manualRelatedArtistsOverride: latestRaw.manualRelatedArtistsOverride,
    relatedArtistEvidence: latestRaw.relatedArtistEvidence,
    relatedArtistsResearch: latestRaw.relatedArtistsResearch,
    relatedArtistResearchVersion: latestRaw.relatedArtistResearchVersion,
    descriptionSource: latestRaw.descriptionSource,
    reviewQuote: latestRaw.reviewQuote,
    reviewSource: latestRaw.reviewSource,
    reviewUrl: latestRaw.reviewUrl,
    metadataSourceUrl: latestRaw.metadataSourceUrl,
    musicBrainzReleaseId: latestRaw.musicBrainzReleaseId,
    enrichmentFingerprint: latestRaw.enrichmentFingerprint,
    enrichmentOrigin: latestRaw.enrichmentOrigin,
    enrichmentStatus: latestRaw.enrichmentStatus,
    enrichmentUpdatedAt: latestRaw.enrichmentUpdatedAt,
    enrichmentAttemptedAt: latestRaw.enrichmentAttemptedAt
  };
  return productRowFromExisting(latest, {
    ...next,
    year: latest.year || next.year,
    label: latest.label,
    collection: latest.collection,
    image: latest.image,
    images: latest.images,
    image_credits: latest.image_credits,
    tags: latest.tags,
    details: latest.details,
    description: latest.description,
    publish_status: latest.publish_status,
    visibility: latest.visibility,
    raw: preservedRaw
  });
}

function hasCompletedCatalogData(row = {}) {
  const raw = row.raw || {};
  const relatedResearchStatus = String(row.relatedArtistsResearch?.status || raw.relatedArtistsResearch?.status || "").trim();
  const relatedResearchComplete = ["verified", "combined", "lastfm", "no-verified-match"].includes(relatedResearchStatus);
  return Boolean(
    hasUsableProductImage(row) &&
    String(row.label || "").trim() &&
    String(row.description || "").trim() &&
    String(raw.reviewQuote || "").trim() &&
    String(raw.reviewSource || "").trim() &&
    (relatedResearchComplete || (Array.isArray(raw.relatedArtists) && raw.relatedArtists.length)) &&
    ["complete", "complete-no-related-artists"].includes(String(raw.enrichmentStatus || "").toLowerCase())
  );
}

function allowResearchPublication(product = {}) {
  if (!isResearchPublicationReady(product)) return product;
  return {
    ...product,
    publish_status: "Published",
    visibility: "Public",
    raw: {
      ...(product.raw || {}),
      publishAfterResearch: true,
      publishStatus: "Published",
      visibility: "Public"
    }
  };
}

async function syncFinanceArtistsToCatalog(productRows = []) {
  const names = [...new Set(
    productRows
      .filter((item) => item?.category === "Records" && item?.publish_status === "Published" && item?.visibility === "Public")
      .flatMap((item) => productArtistCreditNames(item))
      .filter(Boolean)
  )];
  if (!names.length) return;

  const existingRows = await supabaseFetch("artists?select=id,name,sort");
  const existingNames = new Set(existingRows.map((row) => String(row?.name || "").trim().toLowerCase()).filter(Boolean));
  const existingIds = new Set(existingRows.map((row) => String(row?.id || "").trim()).filter(Boolean));
  const nextSort = existingRows.reduce((max, row) => Math.max(max, Number(row?.sort || 0)), 0);
  const additions = [];

  for (const [offset, name] of names.entries()) {
    const key = name.toLowerCase();
    if (existingNames.has(key)) continue;
    const baseId = slugify(name) || `artist-${offset + 1}`;
    const id = existingIds.has(baseId) ? `finance-artist-${baseId}` : baseId;
    if (existingIds.has(id)) continue;
    additions.push({
      id,
      name,
      title: null,
      status: "Published",
      sort: nextSort + additions.length + 1,
      raw: { id, name, status: "Published", sort: nextSort + additions.length + 1, origin: "finance-inventory" }
    });
    existingNames.add(key);
    existingIds.add(id);
  }

  if (additions.length) {
    await supabaseFetch("artists?on_conflict=id", {
      method: "POST",
      body: additions,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }
}

async function deleteStaleFinanceInventoryRows(activeIds = [], { fullSync = false, targetSkuKeys = new Set(), targetInventoryIds = new Set() } = {}) {
  const active = new Set(activeIds.map(String));
  const targetMirrorIds = new Set([...targetInventoryIds].map((id) => financePurchaseMirrorId({ id })));
  const rows = await supabaseFetch("inventory?select=id,raw");
  const staleIds = rows
    .filter((row) => {
      const origin = String(row?.raw?.origin || "");
      if (!["finance-purchase", "finance-stock"].includes(origin) || active.has(String(row.id))) return false;
      if (fullSync) return true;
      const sku = String(row?.raw?.sku || "").trim().toLowerCase();
      return targetSkuKeys.has(sku) || targetMirrorIds.has(String(row.id));
    })
    .map((row) => String(row.id))
    .filter(Boolean);
  if (!staleIds.length) return;
  await supabaseFetch(`inventory?id=in.(${skuList(staleIds)})`, {
    method: "DELETE",
    prefer: "return=minimal"
  });
}

function productRowFromExisting(row, overrides = {}) {
  const next = { ...row, ...overrides };
  const raw = {
    ...(next.raw || {}),
    artist: canonicalArtistName(next.artist || ""),
    label: canonicalLabelName(next.label || ""),
    relatedArtists: Array.isArray(next.raw?.relatedArtists)
      ? next.raw.relatedArtists.map((artist) => canonicalArtistName(artist))
      : next.raw?.relatedArtists || []
  };
  return {
    id: String(next.id),
    sku: next.sku || next.id,
    title: next.title || "Untitled Item",
    artist: canonicalArtistName(next.artist || ""),
    category: next.category || "",
    format: next.format || "",
    display_format: next.display_format || "",
    apparel_type: next.apparel_type || "",
    condition: next.condition || "",
    price: Number(next.price || 0),
    year: Number(next.year || new Date().getFullYear()),
    label: canonicalLabelName(next.label || ""),
    collection: next.collection || "",
    color: next.color || "",
    material: next.material || "",
    image: next.image || next.images?.[0] || "",
    images: next.images || [],
    image_credits: next.image_credits || [],
    tags: next.tags || [],
    details: next.details || [],
    sizes: next.sizes || [],
    description: next.description || "",
    qty: normalizedQuantity(next.qty),
    open_to_offers: next.open_to_offers === true || next.raw?.open_to_offers === true,
    minimum_acceptable_offer: wholeAmount(next.minimum_acceptable_offer ?? next.raw?.minimumAcceptableOffer),
    publish_status: next.publish_status || "Published",
    visibility: next.visibility || "Public",
    updated_at: next.updated_at || today(),
    raw
  };
}

function withSyncAudit(row, { source, action, sku, quantity } = {}) {
  const at = new Date().toISOString();
  const raw = row.raw || {};
  const audit = Array.isArray(raw.syncAudit) ? raw.syncAudit : [];
  const entry = {
    source: String(source || "System"),
    action: String(action || "Catalog synchronized"),
    sku: String(sku || row.sku || ""),
    quantity: normalizedQuantity(quantity ?? row.qty),
    at
  };
  return {
    ...row,
    raw: {
      ...raw,
      syncStatus: entry,
      syncAudit: [entry, ...audit.filter((item) => item?.at !== entry.at)].slice(0, 8)
    }
  };
}

function productRowFromFinanceStock(row, stock, quantity) {
  const item = String(stock.item || row.format || "Vinyl").trim();
  const category = RECORD_FORMATS.has(item)
    ? "Records"
    : APPAREL_TYPES.has(item)
      ? "Apparel"
      : row.category || "Objects";
  // Finance can contain a temporary placeholder while the editorial match is
  // still being completed. It must never erase a real title already stored in
  // Admin or returned by the enrichment step.
  const submittedTitle = String(stock.title || "").trim();
  const financeTitle = isPlaceholderInventoryTitle(submittedTitle) ? "" : submittedTitle;
  const financeArtist = String(stock.artist || "").trim();
  const financePrice = Number(stock.sellingPrice || 0);
  const openToOffers = stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true;
  const minimumAcceptableOffer = wholeAmount(stock.minimumAcceptableOffer);
  const raw = {
    ...(row.raw || {}),
    financeStockId: stock.id || row.raw?.financeStockId || null,
    // Existing catalog quantities can have active checkout reservations. The
    // database reconciler applies Finance quantity minus those reservations.
    qty: normalizedQuantity(row.qty),
    updatedAt: today(),
    shipping: category === "Records"
      ? referenceShippingProfile({ ...row, format: item, edition: stock.edition || row.raw?.edition }, row.raw?.shipping)
      : row.raw?.shipping
  };
  // A SKU can change category while it is being corrected in Finance. Remove
  // record-only research state when that happens so the Admin editor cannot
  // show stale label/review/related-artist blockers for apparel or objects.
  if (category !== "Records") {
    delete raw.publicationIssues;
    delete raw.enrichmentStatus;
    delete raw.enrichmentOrigin;
    delete raw.relatedArtists;
    delete raw.relatedArtistsResearch;
    delete raw.relatedArtistEvidence;
    delete raw.relatedArtistResearchVersion;
    delete raw.autoEditorial;
  }

  const wasFinanceDraft =
    String(row.id || "").startsWith("finance-") ||
    row.raw?.financeStockId ||
    String(row.raw?.details?.[0] || "").includes("Created from finance inventory");
  const readyFromFinance = category === "Records"
    ? isRecordPublicationReady({ ...row, ...raw, title: financeTitle || row.title, artist: financeArtist || row.artist, price: openToOffers ? 0 : financePrice || row.price, open_to_offers: openToOffers, minimum_acceptable_offer: minimumAcceptableOffer })
    : Boolean(financeTitle && (openToOffers ? minimumAcceptableOffer : financePrice > 0) && hasUsableProductImage(row));
  const adminUnpublished = row.raw?.adminPublishOverride === "Draft";
  const publishStatus = adminUnpublished
    ? "Draft"
    : wasFinanceDraft
      ? (readyFromFinance ? "Published" : "Draft")
      : row.publish_status || "Published";
  const visibility = adminUnpublished
    ? "Private"
    : wasFinanceDraft
      ? (readyFromFinance ? "Public" : "Private")
      : row.visibility || "Public";

  return productRowFromExisting(row, {
    title: financeTitle || row.title,
    artist: canonicalProductArtist({ ...row, artist: financeArtist || row.artist }),
    category,
    format: category === "Records" ? item : row.format || "",
    display_format: category === "Records" ? item : row.display_format || "",
    apparel_type: category === "Apparel" ? row.apparel_type || "Accessories" : row.apparel_type || "",
    condition: String(stock.itemCondition || row.condition || "").trim(),
    price: openToOffers ? 0 : financePrice > 0 ? financePrice : Number(row.price || 0),
    open_to_offers: openToOffers,
    minimum_acceptable_offer: openToOffers ? minimumAcceptableOffer : null,
    qty: normalizedQuantity(row.qty),
    publish_status: publishStatus,
    visibility,
    updated_at: today(),
    raw: {
      ...raw,
      title: financeTitle || raw.title || row.title,
      artist: canonicalProductArtist({ ...row, ...raw, artist: financeArtist || raw.artist || row.artist }),
      category,
      format: category === "Records" ? item : raw.format || row.format || "",
      displayFormat: category === "Records" ? item : raw.displayFormat || row.display_format || "",
      condition: String(stock.itemCondition || raw.condition || row.condition || "").trim(),
      price: openToOffers ? 0 : financePrice > 0 ? financePrice : Number(raw.price || row.price || 0),
      open_to_offers: openToOffers,
      minimumAcceptableOffer: openToOffers ? minimumAcceptableOffer : null,
      edition: adminOwnedValue(raw, "edition", stock.edition),
      barcode: adminOwnedValue(raw, "barcode", stock.barcode),
      catalogNumber: adminOwnedValue(raw, "catalogNumber", stock.catalogNumber),
      publishStatus,
      visibility
    }
  });
}

function adminOwnedValue(raw, key, seedValue) {
  if (Object.prototype.hasOwnProperty.call(raw || {}, key)) return String(raw[key] ?? "").trim();
  return String(seedValue || "").trim();
}

function openToOffersPrice(stock = {}) {
  const openToOffers = stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true;
  return openToOffers ? 0 : Math.max(0, Number(stock.sellingPrice || 0));
}

function isPlaceholderInventoryTitle(value) {
  return /^(?:untitled(?:\s+inventory)?\s+item|new\s+inventory\s+item)$/i.test(String(value || "").trim());
}

function hasUsableProductImage(row = {}) {
  const images = [row.image, ...(Array.isArray(row.images) ? row.images : [])]
    .map((image) => String(image || "").trim())
    .filter(Boolean);
  return images.some((image) => !image.includes("nixp-product-example"));
}

export function needsFinanceEnrichment(row = {}, stock = {}) {
  const financeOrigin =
    String(row.id || "").startsWith("finance-") ||
    Boolean(row.raw?.financeStockId) ||
    Boolean(row.raw?.enrichmentStatus);
  if (!financeOrigin) return false;
  const previousFingerprint = String(row.raw?.enrichmentFingerprint || "");
  const currentFingerprint = inventoryFingerprint(stock);
  const fingerprintChanged = Boolean(previousFingerprint) && currentFingerprint !== previousFingerprint;
  const status = String(row.raw?.enrichmentStatus || "").toLowerCase();
  const recordFormat = RECORD_FORMATS.has(String(stock.item || row.format || "").trim());
  const researchVersionChanged = recordFormat &&
    String(row.raw?.relatedArtistResearchVersion || "") !== RELATED_ARTIST_RESEARCH_VERSION;
  const attemptedAt = Date.parse(String(row.raw?.enrichmentAttemptedAt || ""));
  const retryDue = !Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 5 * 60 * 1000;
  const unresolvedStatus = [
    "needs-release-match",
    "needs-pressing-identifier",
    "needs-cover-art",
    "needs-cover-archive",
    "needs-product-photo",
    "needs-product-photo-archive",
    "needs-editorial-metadata",
    "needs-editorial-quality",
    "metadata-complete-no-related-artists",
    "metadata-complete-needs-editorial-review"
  ].includes(status);
  const editorialQualityPending = recordFormat && !isEditorialDescriptionQuality(
    row.description,
    row.descriptionSource || row.raw?.descriptionSource || ""
  );
  const placeholderTitle = isPlaceholderInventoryTitle(row.title);
  // Do not make a corrected source wait for the retry window: incomplete
  // enrichment must be immediately repairable by the next catalog sync.
  if (previousFingerprint && !fingerprintChanged && status && !retryDue && !researchVersionChanged && !editorialQualityPending) return false;
  return Boolean(
    fingerprintChanged ||
    researchVersionChanged ||
    placeholderTitle ||
    !hasUsableProductImage(row) ||
      !String(row.label || "").trim() ||
      !String(row.description || "").trim() ||
      !isRecordPublicationReady(row) ||
      String(row.publish_status || "") !== "Published" ||
      String(row.visibility || "") !== "Public" ||
      unresolvedStatus ||
      editorialQualityPending
  );
}

export async function syncAdminProductInventory(product) {
  return syncAdminCatalogInventory([product]);
}

// Apply a full Admin catalog deployment in one state write. Writing each product
// individually would allow concurrent writes to overwrite one another.
export async function syncAdminCatalogInventory(products = []) {
  const catalogProducts = (Array.isArray(products) ? products : [products]).filter((product) => product?.sku);
  if (!catalogProducts.length) return;
  const currentSnapshot = await readFinanceStateWithVersion();
  const current = normalizeFinanceState(currentSnapshot.state || EMPTY_FINANCE_STATE);
  const existingIndexes = new Map(
    current.inventoryStock.map((item, index) => [String(item?.sku || "").trim().toLowerCase(), index])
  );

  for (const product of catalogProducts) {
    const sku = String(product.sku).trim();
    const key = sku.toLowerCase();
    const index = existingIndexes.get(key);
    const existing = index === undefined ? {} : current.inventoryStock[index];
    const catalogQuantity = Array.isArray(product.sizes) && product.sizes.length
      ? product.sizes.reduce((sum, size) => sum + normalizedQuantity(size.quantity ?? size.qty), 0)
      : normalizedQuantity(product.qty);
    // Admin owns editorial fields. Once a Finance stock row exists, Admin
    // saves must not replace its quantity with a stale catalog snapshot.
    const quantity = index === undefined ? catalogQuantity : normalizedQuantity(existing.qty);
    const nextStock = recalculateStock({
      ...existing,
      id: existing.id || `catalog-${product.id}`,
      sku,
      item: financeItemForProduct(product),
      itemCondition: product.condition || existing.itemCondition || "New-Sealed",
      artist: product.artist || existing.artist || "",
      title: product.title || existing.title || "",
      edition: product.edition ?? existing.edition ?? "",
      barcode: product.barcode ?? existing.barcode ?? "",
      catalogNumber: product.catalogNumber ?? existing.catalogNumber ?? "",
      mediaCondition: product.mediaCondition ?? existing.mediaCondition ?? "",
      sleeveCondition: product.sleeveCondition ?? existing.sleeveCondition ?? "",
      source: existing.source || "Admin editor",
      acquisitionMonth: existing.acquisitionMonth || new Date().toISOString().slice(0, 7),
      qty: quantity,
      costBasis: Number(existing.costBasis || 0),
      sellingPrice: product.open_to_offers ? 0 : Number(existing.sellingPrice || product.price || 0),
      listingMode: product.open_to_offers ? "Private Collection / Offer Only" : existing.listingMode || "Standard Sale",
      minimumAcceptableOffer: wholeAmount(product.minimumAcceptableOffer ?? existing.minimumAcceptableOffer),
      inventoryFamily: catalogInventoryFamily(product) || existing.inventoryFamily || "Other",
      soldPrice: Number(existing.soldPrice || 0)
    });
    if (index === undefined) {
      existingIndexes.set(key, current.inventoryStock.length);
      current.inventoryStock.push(nextStock);
    } else {
      current.inventoryStock[index] = nextStock;
    }
  }
  await writeFinanceState(current, { syncCatalog: false, expectedSectionVersions: currentSnapshot.sectionVersions });
  await reconcileFinanceStockToCatalog(catalogProducts.map((product) => product.sku));
}

async function backupFinanceState(previousState, nextState, changes) {
  const id = `finance-state-${new Date().toISOString().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  await supabaseFetch("store_backups", {
    method: "POST",
    body: [{
      id,
      source: "finance-state-change",
      raw: {
        changedSections: Object.keys(changes),
        previous: Object.fromEntries(Object.keys(changes).map((section) => [section, previousState[section]])),
        next: Object.fromEntries(Object.keys(changes).map((section) => [section, nextState[section]]))
      }
    }],
    prefer: "return=minimal"
  });
  return id;
}

export function normalizeFinanceState(state) {
  return {
    general: Array.isArray(state.general) ? state.general : [],
    sales: Array.isArray(state.sales) ? state.sales : [],
    expenses: Array.isArray(state.expenses) ? state.expenses : [],
    inventory: Array.isArray(state.inventory) ? state.inventory : [],
    inventoryStock: Array.isArray(state.inventoryStock) ? state.inventoryStock : [],
    monthlyReports: Array.isArray(state.monthlyReports) ? state.monthlyReports : [],
    openingCash: state.openingCash === null || state.openingCash === undefined || state.openingCash === ""
      ? null
      : Number.isFinite(Number(state.openingCash)) ? Number(state.openingCash) : null,
    targets: state.targets && typeof state.targets === "object" && !Array.isArray(state.targets)
      ? state.targets
      : {}
  };
}

export function draftProductFromFinanceStock(stock, quantity) {
  const item = String(stock.item || "Vinyl").trim();
  const category = RECORD_FORMATS.has(item) ? "Records" : APPAREL_TYPES.has(item) ? "Apparel" : "Objects";
  const id = `finance-${slugify(stock.sku)}`;
  const product = {
    id,
    sku: String(stock.sku).trim(),
    title: String(stock.title || "Untitled inventory item").trim(),
    artist: String(stock.artist || "NIXP").trim(),
    category,
    format: category === "Records" ? item : category === "Apparel" ? "Apparel" : "Object",
    displayFormat: category === "Records" ? item : "",
    apparelType: category === "Apparel" ? "Accessories" : "",
    condition: String(stock.itemCondition || "").trim(),
    price: stock.listingMode === "Private Collection / Offer Only" ? 0 : Number(stock.sellingPrice || 0),
    open_to_offers: stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true,
    minimumAcceptableOffer: wholeAmount(stock.minimumAcceptableOffer),
    year: new Date().getFullYear(),
    label: "",
    collection: "",
    color: "",
    material: "",
    image: "",
    images: [],
    imageCredits: [],
    tags: [],
    details: ["Created from finance inventory. Complete this draft in NIXP Admin before publishing."],
    sizes: [],
    description: "",
    qty: quantity,
    // Finance creates an operational inventory draft only. Publication and
    // any internet research remain explicit Admin actions for this exact SKU.
    publishStatus: "Draft",
    visibility: "Private",
    updatedAt: today(),
    financeStockId: stock.id || null
  };
  product.edition = String(stock.edition || "").trim();
  product.barcode = String(stock.barcode || "").trim();
  product.catalogNumber = String(stock.catalogNumber || "").trim();
  if (category === "Records") product.shipping = referenceShippingProfile(product);
  return {
    id,
    sku: product.sku,
    title: product.title,
    artist: product.artist,
    category: product.category,
    format: product.format,
    display_format: product.displayFormat,
    apparel_type: product.apparelType,
    condition: product.condition,
    price: product.price,
    year: product.year,
    label: product.label,
    collection: product.collection,
    color: product.color,
    material: product.material,
    image: product.image,
    images: product.images,
    image_credits: product.imageCredits,
    tags: product.tags,
    details: product.details,
    sizes: product.sizes,
    description: product.description,
    qty: product.qty,
    open_to_offers: product.open_to_offers === true,
    minimum_acceptable_offer: wholeAmount(product.minimumAcceptableOffer),
    publish_status: product.publishStatus,
    visibility: product.visibility,
    updated_at: product.updatedAt,
    raw: product
  };
}

function financeInventoryRow(item, productIdBySku) {
  const sku = String(item?.sku || "").trim();
  const rowId = financePurchaseMirrorId(item);
  return {
    id: rowId,
    name: null,
    title: item.itemType || "Inventory purchase",
    status: "Synced",
    sort: 0,
    raw: {
      ...item,
      id: rowId,
      productId: productIdBySku.get(sku.toLowerCase()) || null,
      origin: "finance-purchase",
      updatedAt: today()
    }
  };
}

function dedupeRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    byId.set(String(row.id), row);
  }
  return [...byId.values()];
}

function financeStockRow(item, productIdBySku) {
  const sku = String(item?.sku || "").trim();
  const productId = productIdBySku.get(sku.toLowerCase()) || null;
  return {
    id: productId || `finance-stock-${item.id || slugify(sku)}`,
    name: null,
    title: item.title || item.item || "Inventory stock",
    status: "Synced",
    sort: 0,
    raw: {
      ...item,
      id: productId || `finance-stock-${item.id || slugify(sku)}`,
      productId,
      origin: "finance-stock",
      updatedAt: today()
    }
  };
}

function financeItemForProduct(product) {
  if (product.category === "Records") return product.format || "Vinyl";
  if (product.category === "Apparel") return product.apparelType === "Accessories" ? "Cap" : product.title || "Apparel";
  return "Object";
}

// Related-artist maintenance must never run the full finance/catalog
// enrichment pipeline. This action patches only the raw related-artist fields
// so covers, descriptions, prices, stock, labels, and publication state stay
// untouched.
export async function refreshRelatedArtistsOnly({ skus = [] } = {}) {
  const normalizedSkus = [...new Set(skus.map((sku) => String(sku || "").trim()).filter(Boolean))];
  const path = normalizedSkus.length
    ? `products?select=*&category=eq.Records&sku=in.(${skuList(normalizedSkus)})`
    : "products?select=*&category=eq.Records";
  const rows = await supabaseFetch(path);
  const backup = rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    raw: row.raw || {}
  }));
  await supabaseFetch("store_backups", {
    method: "POST",
    body: [{
      id: `related-artists-only-${new Date().toISOString().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`,
      source: "related-artists-only",
      raw: { generatedAt: new Date().toISOString(), products: backup }
    }],
    prefer: "return=minimal"
  });

  const results = [];
  for (const originalRow of rows) {
    let row = originalRow;
    let saved = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = row.raw || {};
      const existingAutomaticRelatedArtists = Array.isArray(raw.autoEditorial?.relatedArtists)
        ? raw.autoEditorial.relatedArtists
        : Array.isArray(raw.relatedArtistsResearch?.artists) ? raw.relatedArtistsResearch.artists : [];
      if (isExplicitManualRelatedArtistsOverride(raw, existingAutomaticRelatedArtists)) {
        results.push({ sku: row.sku, status: "manual-override", relatedArtists: raw.relatedArtists || [] });
        saved = true;
        break;
      }
      const research = await researchRelatedArtists({
        artist: row.artist,
        title: row.title,
        format: row.format,
        releaseId: String(raw.musicBrainzReleaseId || "").trim()
      });
      const relatedArtistPayload = normalizeRelatedArtistsPayload({ raw, research });
      const relatedArtists = relatedArtistPayload.relatedArtists;
      const previousEnrichmentStatus = String(raw.enrichmentStatus || "").trim();
      const enrichmentStatus = previousEnrichmentStatus.startsWith("complete")
        ? (relatedArtists.length ? "complete" : "complete-no-related-artists")
        : previousEnrichmentStatus;
      const nextRaw = {
        ...raw,
        relatedArtists,
        manualRelatedArtists: relatedArtistPayload.manualRelatedArtists,
        manualRelatedArtistsOverride: relatedArtistPayload.manualRelatedArtistsOverride,
        manualRelatedArtistsOverrideSource: relatedArtistPayload.manualRelatedArtistsOverride
          ? raw.manualRelatedArtistsOverrideSource || "admin"
          : "",
        relatedArtistEvidence: research.evidence || [],
        relatedArtistsResearch: research,
        relatedArtistResearchVersion: RELATED_ARTIST_RESEARCH_VERSION,
        enrichmentStatus,
        autoEditorial: {
          ...(raw.autoEditorial || {}),
          relatedArtists,
          relatedArtistEvidence: research.evidence || [],
          relatedArtistsResearch: research,
          relatedArtistResearchVersion: RELATED_ARTIST_RESEARCH_VERSION,
          enrichmentStatus
        }
      };
      const currentRevision = Math.max(1, Number(row.edit_revision) || 1);
      const updated = await supabaseFetch(
        `products?id=eq.${encodeURIComponent(row.id)}&edit_revision=eq.${currentRevision}`,
        {
          method: "PATCH",
          body: {
            raw: nextRaw,
            edit_revision: currentRevision + 1,
            updated_at: today(),
            editorial_updated_at: new Date().toISOString(),
            editorial_updated_by: "related-artists-research"
          },
          service: true,
          prefer: "return=representation"
        }
      );
      if (updated?.[0]) {
        results.push({ sku: row.sku, status: research.status, relatedArtists, evidence: research.evidence?.length || 0 });
        saved = true;
        break;
      }
      const latestRows = await supabaseFetch(`products?select=*&id=eq.${encodeURIComponent(row.id)}&limit=1`, { service: true });
      if (!latestRows?.[0]) {
        results.push({ sku: row.sku, status: "missing", relatedArtists: [] });
        saved = true;
        break;
      }
      row = latestRows[0];
    }
    if (!saved) {
      results.push({
        sku: originalRow.sku,
        status: "conflict",
        relatedArtists: [],
        message: "A newer product edit arrived while related artists were refreshing. The automatic result was not saved."
      });
    }
  }
  return { version: RELATED_ARTIST_RESEARCH_VERSION, processed: results.length, results };
}

function catalogInventoryFamily(product = {}) {
  if (product.category === "Records") return "Records";
  if (product.category === "Apparel") return "Apparel";
  if (["Objects", "Object", "Publishing"].includes(product.category)) return "Other";
  return "";
}

function recalculateStock(item) {
  const quantity = normalizedQuantity(item.qty);
  const costBasis = Number(item.costBasis || 0);
  const soldPrice = Number(item.soldPrice || 0);
  return {
    ...item,
    qty: quantity,
    costBasis,
    sellingPrice: Number(item.sellingPrice || 0),
    soldPrice,
    grossProfit: soldPrice > 0 ? soldPrice - costBasis : 0,
    margin: soldPrice > 0 ? ((soldPrice - costBasis) / soldPrice) * 100 : 0
  };
}

function normalizedQuantity(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function wholeAmount(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function skuList(values) {
  return values.map((value) => `"${String(value).replaceAll('"', '\\"')}"`).join(",");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "inventory-item";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readRemoteState() {
  return (await readFinanceStateWithVersion())?.state || null;
}

function financePurchaseMirrorId(item = {}) {
  return `finance-purchase-${item.id || item.sku || slugify(item.itemType || item.title || item.date)}`;
}

export function changedFinanceSections(previous = EMPTY_FINANCE_STATE, next = EMPTY_FINANCE_STATE, requestedSections = null) {
  const allowed = Array.isArray(requestedSections)
    ? requestedSections.filter((section) => FINANCE_SECTIONS.includes(section))
    : FINANCE_SECTIONS;
  return Object.fromEntries(
    allowed
      .filter((section) => JSON.stringify(previous[section]) !== JSON.stringify(next[section]))
      .map((section) => [section, next[section]])
  );
}

async function readRemoteSectionsWithVersion() {
  const rows = await supabaseFetch("finance_state_sections?select=section,payload,revision,updated_at&order=section.asc");
  if (!Array.isArray(rows) || rows.length !== FINANCE_SECTIONS.length) return null;
  const bySection = new Map(rows.map((row) => [row.section, row]));
  if (FINANCE_SECTIONS.some((section) => !bySection.has(section))) return null;
  const state = Object.fromEntries(FINANCE_SECTIONS.map((section) => [section, bySection.get(section).payload]));
  const sectionVersions = Object.fromEntries(FINANCE_SECTIONS.map((section) => [section, Number(bySection.get(section).revision)]));
  const updatedAt = FINANCE_SECTIONS.map((section) => `${section}:${sectionVersions[section]}`).join("|");
  return { state: normalizeFinanceState(state), updatedAt, sectionVersions };
}

async function readLegacyStateWithVersion() {
  const rows = await supabaseFetch(`finance_state?select=state,updated_at&key=eq.${STATE_KEY}&limit=1`);
  const row = rows?.[0];
  return row ? { state: row.state, updatedAt: row.updated_at || null } : null;
}

async function supabaseFetch(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Supabase finance state failed: ${response.status}`);
  return payload;
}

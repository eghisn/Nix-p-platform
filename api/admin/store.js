import { getSession, json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, loadStore, saveAdminHomeSlider, saveAdminProduct, saveStore, supabaseFetch } from "../_lib/supabase.js";
import { commitPublicStore, isGitHubDeployConfigured } from "../_lib/github.js";
import { verifyPublicCatalogRevision } from "../_lib/publicCatalogDeployment.js";
import { handleAdminOrders } from "../_lib/commerceHandlers.js";
import { processCatalogResearchJobs, readFinanceState, refreshRelatedArtistsOnly, syncFinanceInventoryToCatalog } from "../_lib/financeState.js";
import { enqueueAdminFinanceSyncJob, processAdminFinanceSyncJobs } from "../_lib/adminFinanceSyncJobs.js";
import { getShippingDashboard, saveShippingSettings } from "../_lib/shippingQuotes.js";
import { importPublicTariffSnapshot, refreshRecentTariffs, runShippingMaintenance, syncDestinationsNow } from "../_lib/nixpShippingEngine.js";
import { drainNotificationOutbox, getNotificationOutboxHealth, retryFailedNotificationOutbox, sendProductStatusNotification } from "../_lib/emailNotifications.js";
import { applyCatalogPublicationSafety, catalogPublicationIssues, isResearchPublicationReady } from "../../src/data/catalogPublication.js";

export default async function handler(req, res) {
  const action = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("commerceAction");
  if (action === "orders") return handleAdminOrders(req, res);
  if (action === "inventory") return handleAdminInventory(req, res);
  if (action === "shipping-rates") return handleAdminShipping(req, res);
  if (action === "product") return handleAdminProductSave(req, res);
  if (action === "home-slider") return handleAdminHomeSliderSave(req, res);
  if (action === "backups") {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
    if (!requireWorkspace(req, res, "admin")) return;
    if (!isSupabaseConfigured({ requireServiceRole: true })) {
      return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
    }
    try {
      const rows = await supabaseFetch(
        "store_backups?select=id,source,created_at,raw&source=eq.admin-store&order=created_at.desc&limit=12",
        { service: true }
      );
      const backups = rows.map((row) => ({
        id: row.id,
        source: row.source,
        createdAt: row.created_at,
        homeSlider: (row.raw?.products || []).map((product) => ({
          id: product.id,
          sku: product.sku,
          homeCollections: product.homeCollections || [],
          homeSlideSort: product.homeSlideSort ?? null
        }))
      }));
      return json(res, 200, { ok: true, backups });
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Backup history unavailable" });
    }
  }
  if (action === "email-health") {
    if (!requireWorkspace(req, res, "admin")) return;
    try {
      if (req.method === "GET") {
        return json(res, 200, { ok: true, health: await getNotificationOutboxHealth() });
      }
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const retry = await retryFailedNotificationOutbox(body.idempotencyKey || "");
      const drain = retry.requeued ? await drainNotificationOutbox(Math.min(retry.requeued, 50)) : { processed: 0, delivered: 0 };
      return json(res, 200, { ok: true, retry, drain, health: await getNotificationOutboxHealth() });
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Email outbox health check failed." });
    }
  }
  if (action === "catalog-sync") {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const session = getSession(req);
    if (!session || !["admin", "finance"].includes(session.workspace)) {
      return json(res, 401, { ok: false, error: "Admin or Finance login required" });
    }
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (body.action === "deploy-current") {
        if (session.workspace !== "admin") {
          return json(res, 403, { ok: false, error: "Admin login required to deploy the public catalog." });
        }
        const store = applyCatalogPublicationSafety(await loadStore({ privateScope: true }));
        if (!isGitHubDeployConfigured()) {
          return json(res, 200, {
            ok: true,
            message: "Draft completion saved to Supabase. GitHub deployment is not configured.",
            github: { skipped: true, reason: "missing_token" }
          });
        }
        const requestedMessage = String(body.message || "").trim().replace(/\s+/g, " ").slice(0, 160);
        const github = await commitPublicStore(store, {
          message: requestedMessage || `Deploy current NIXP catalog ${new Date().toISOString()}`
        });
        const live = await verifyPublicCatalogRevision((store.products || []).filter((product) => product.publishStatus === "Published" && product.visibility === "Public"));
        return json(res, 200, {
          ok: true,
          message: live.confirmed
            ? "Catalog is confirmed live on the public site."
            : "Saved and committed. Vercel deployment is still pending public verification.",
          github,
          deployment: live
        });
      }

      const requestedSkus = [...new Set((Array.isArray(body.skus) ? body.skus : [])
        .map((sku) => String(sku || "").trim())
        .filter(Boolean))].slice(0, 25);
      const financeState = await readFinanceState();
      await syncFinanceInventoryToCatalog(financeState, {
        enrich: false
      });
      // A catalog sync is allowed to create or refresh Admin drafts, but it
      // must never claim a research job unless the caller named exact SKU(s).
      // This keeps Finance saves and incidental Admin refreshes from turning
      // into an unrequested catalogue-wide research run.
      const research = requestedSkus.length
        ? await processCatalogResearchJobs({
            limit: Math.max(1, Math.min(5, requestedSkus.length)),
            skus: requestedSkus,
            force: body.force === true,
            publishAfterResearch: body.publishAfterResearch === true,
            requestedBy: "admin-research-complete"
          })
        : { queued: 0, processed: 0, results: [] };
      // Supabase writes are complete before the request returns, but a read
      // through a separate connection can briefly see the previous row. Read
      // the private catalog again before reporting failure so the Admin UI
      // never shows a stale "not published" result after a successful write.
      let store = null;
      let report = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        store = applyCatalogPublicationSafety(await loadStore({ privateScope: true }));
        report = catalogCompletionReport(store.products || [], requestedSkus);
        if (!report.remaining || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      let deployment = null;
      if (body.publishAfterResearch === true && report.published && isGitHubDeployConfigured()) {
        const github = await commitPublicStore(store, { message: `Publish researched NIXP catalog ${new Date().toISOString()}` });
        deployment = { github, ...(await verifyPublicCatalogRevision(store.products || [], requestedSkus)) };
        const jobs = await import("../_lib/catalogResearchJobs.js");
        const publicationJobs = jobs.publicationJobsForProducts(
          await jobs.catalogResearchJobSummary(requestedSkus, { statuses: ["ready", "deployment_pending"] }),
          store.products || []
        );
        if (deployment.confirmed) await jobs.markCatalogResearchJobsLive(publicationJobs, deployment.github);
        else await jobs.markCatalogResearchJobsDeploymentPending(publicationJobs, deployment.github);
      }
      return json(res, 200, {
        ok: true,
        inventoryStock: financeState.inventoryStock?.length || 0,
        report,
        research,
        deployment,
        message: report.remaining
          ? `${report.published} product(s) completed; ${report.remaining} still require a verified source.`
          : deployment?.confirmed
            ? `${report.published} product(s) completed and confirmed live.`
            : `${report.published} product(s) completed and publication-ready.`
      });
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Catalog sync failed" });
    }
  }
  if (action === "catalog-related-artists") {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const session = getSession(req);
    if (!session || session.workspace !== "admin") return json(res, 401, { ok: false, error: "Admin login required" });
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const skus = Array.isArray(body.skus) ? body.skus : [];
      if (!skus.length) return json(res, 400, { ok: false, error: "At least one SKU is required for a related-artist refresh." });
      const result = await refreshRelatedArtistsOnly({ skus });
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Related artist refresh failed" });
    }
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    await saveStore(body.store || {}, {
      tables: ["artists", "collections", "requests", "offers"]
    });
    json(res, 200, { ok: true, path: "supabase://public", catalogSynced: false, inventorySynced: false, store: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store save failed";
    const friendlyMessage = message.toLowerCase().includes("on conflict do update")
      ? "Store save blocked by duplicate row IDs. Refresh the admin editor and save again."
      : message;
    json(res, 500, { ok: false, error: friendlyMessage });
  }
}

async function handleAdminInventory(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;
  try {
    const rows = await supabaseFetch("inventory?select=*&order=created_at.desc", { service: true });
    return json(res, 200, { ok: true, inventory: (rows || []).map((row) => row.raw || row) });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Inventory unavailable." });
  }
}

async function handleAdminHomeSliderSave(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireWorkspace(req, res, "admin");
  if (!session) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const products = await saveAdminHomeSlider(body.updates || [], { actor: session.username || "admin" });
    return json(res, 200, { ok: true, products });
  } catch (error) {
    return json(res, Number(error?.statusCode || 500), {
      ok: false,
      error: error instanceof Error ? error.message : "Home slider save failed."
    });
  }
}

async function handleAdminProductSave(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  const session = requireWorkspace(req, res, "admin");
  if (!session) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const saved = await saveAdminProduct(body.product || {}, {
      expectedRevision: body.expectedRevision,
      actor: session.username || "admin"
    });
    let financeSync;
    try {
      const queuedJob = await enqueueAdminFinanceSyncJob(saved.product);
      const processed = await processAdminFinanceSyncJobs({ limit: 1, productId: saved.product.id });
      financeSync = processed.results.find((result) => result.jobId === queuedJob.id) || processed.results[0] || {
        jobId: queuedJob.id,
        status: "queued",
        synced: false,
        pending: true,
        message: "Finance inventory sync is queued and will retry automatically."
      };
    } catch (error) {
      financeSync = {
        status: "needs_attention",
        synced: false,
        pending: false,
        message: error instanceof Error ? error.message : "Finance inventory sync needs attention."
      };
    }
    const nextStatus = String(saved.product.publishStatus || "").trim();
    if (nextStatus && nextStatus !== saved.previousStatus) {
      await sendProductStatusNotification(saved.product, saved.previousStatus).catch((error) => {
        console.warn("Product status notification not delivered", {
          productId: saved.product.id,
          reason: error instanceof Error ? error.message : "unknown"
        });
      });
    }
    return json(res, saved.created ? 201 : 200, {
      ok: true,
      product: saved.product,
      financeSynced: financeSync.synced === true,
      financeSync,
      warning: financeSync.message || ""
    });
  } catch (error) {
    return json(res, Number(error?.statusCode || 500), {
      ok: false,
      error: error instanceof Error ? error.message : "Product save failed.",
      currentProduct: error?.currentProduct || null
    });
  }
}

function catalogCompletionReport(products = [], requestedSkus = []) {
  const requested = new Set(requestedSkus.map((sku) => String(sku).trim().toLowerCase()));
  const candidates = products.filter((product) => !requested.size || requested.has(String(product.sku || "").trim().toLowerCase()));
  const items = candidates.map((product) => {
    const publicationIssues = catalogPublicationIssues(product);
    const enrichmentStatus = product.enrichmentStatus || product.raw?.enrichmentStatus || "";
    const issues = researchFailureIssues(enrichmentStatus, publicationIssues);
    const partialResearch = String(product.category || "").toLowerCase() === "records" && product.raw?.publishAfterResearch === true && isResearchPublicationReady(product);
    const published = product.publishStatus === "Published" && product.visibility === "Public" && (!issues.length || partialResearch);
    return {
      id: product.id,
      sku: product.sku,
      artist: product.artist,
      title: product.title,
      published,
      publishedAfterResearch: partialResearch && issues.length > 0,
      enrichmentStatus,
      issues
    };
  });
  const found = new Set(items.map((item) => String(item.sku || "").trim().toLowerCase()));
  for (const sku of requestedSkus) {
    if (found.has(String(sku).trim().toLowerCase())) continue;
    items.push({
      id: null,
      sku,
      artist: "",
      title: "",
      published: false,
      enrichmentStatus: "missing-finance-item",
      issues: ["SKU was not found in Finance inventory after synchronization"]
    });
  }
  return {
    processed: items.length,
    published: items.filter((item) => item.published).length,
    remaining: items.filter((item) => !item.published).length,
    items
  };
}

function researchFailureIssues(status, publicationIssues = []) {
  const code = String(status || "").trim().toLowerCase();
  const specific = {
    "needs-finance-data": "Finance identity is incomplete: title, artist, format, condition, or price",
    "needs-release-match": "No exact release source matched the Finance artist, title, and format",
    "needs-pressing-identifier": "Exact album found, but more than one physical pressing exists. Add the catalog number or barcode from the item before publishing",
    "needs-cover-art": "Exact release matched, but no verified cover artwork was found",
    "needs-cover-archive": "Verified cover found, but NIXP could not archive it to managed storage",
    "needs-editorial-metadata": "Exact release matched, but the source description could not be prepared",
    "needs-editorial-quality": "Exact release matched, but the description is only generic release metadata and needs editorial copy",
    "needs-related-artist-research": "Exact release matched, but related-artist research returned no verified result",
    "metadata-complete-needs-editorial-review": "Exact release matched, but no trusted review source was available"
  }[code];
  return specific ? [specific] : publicationIssues;
}

async function handleAdminShipping(req, res) {
  if (!requireWorkspace(req, res, "admin")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  try {
    if (req.method === "GET") {
      return json(res, 200, { ok: true, ...(await getShippingDashboard()) });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action === "save-settings") return json(res, 200, { ok: true, settings: await saveShippingSettings(body) });
    if (body.action === "health-check") return json(res, 200, { ok: true, maintenance: await runShippingMaintenance({ mode: "manual" }) });
    if (body.action === "sync-destinations") return json(res, 200, { ok: true, sync: await syncDestinationsNow() });
    if (body.action === "refresh-tariffs") return json(res, 200, { ok: true, refresh: await refreshRecentTariffs() });
    if (body.action === "import-public-tariff-snapshot") return json(res, 200, { ok: true, import: await importPublicTariffSnapshot(body) });
    return json(res, 400, { ok: false, error: "Unsupported shipping action." });
  } catch (error) {
    return json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Shipping settings could not be updated." });
  }
}

import { getSession, json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, loadStore, saveStore, supabaseFetch } from "../_lib/supabase.js";
import { commitPublicStore, isGitHubDeployConfigured } from "../_lib/github.js";
import { handleAdminOrders } from "../_lib/commerceHandlers.js";
import { readFinanceState, syncFinanceInventoryToCatalog } from "../_lib/financeState.js";
import { getShippingDashboard, saveShippingSettings } from "../_lib/shippingQuotes.js";
import { importPublicTariffSnapshot, refreshRecentTariffs, runShippingMaintenance, syncDestinationsNow } from "../_lib/nixpShippingEngine.js";
import { drainNotificationOutbox, getNotificationOutboxHealth, retryFailedNotificationOutbox } from "../_lib/emailNotifications.js";
import { applyCatalogPublicationSafety, isResearchPublicationReady, recordPublicationIssues } from "../../src/data/catalogPublication.js";

export default async function handler(req, res) {
  const action = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("commerceAction");
  if (action === "orders") return handleAdminOrders(req, res);
  if (action === "shipping-rates") return handleAdminShipping(req, res);
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
        const github = await commitPublicStore(store, {
          message: `Complete NIXP draft catalog ${new Date().toISOString()}`
        });
        return json(res, 200, {
          ok: true,
          message: "Completed products saved to Supabase and committed to GitHub. Vercel will deploy the update.",
          github
        });
      }

      const requestedSkus = [...new Set((Array.isArray(body.skus) ? body.skus : [])
        .map((sku) => String(sku || "").trim())
        .filter(Boolean))].slice(0, 25);
      const financeState = await readFinanceState();
      await syncFinanceInventoryToCatalog(financeState, {
        enrich: true,
        forceEnrichment: body.force === true,
        targetSkus: requestedSkus,
        publishAfterResearch: body.publishAfterResearch === true
      });
      const store = applyCatalogPublicationSafety(await loadStore({ privateScope: true }));
      const report = catalogCompletionReport(store.products || [], requestedSkus);
      return json(res, 200, {
        ok: true,
        inventoryStock: financeState.inventoryStock?.length || 0,
        report,
        message: report.remaining
          ? `${report.published} product(s) completed; ${report.remaining} still require a verified source.`
          : `${report.published} product(s) completed and publication-ready.`
      });
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Catalog sync failed" });
    }
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    await saveStore(body.store || {}, { inventoryProduct: body.inventoryProduct || null });
    let catalogSynced = false;
    if (body.inventoryProduct?.category === "Records") {
      const financeState = await readFinanceState();
      await syncFinanceInventoryToCatalog(financeState, { enrich: true });
      catalogSynced = true;
    }
    const refreshedStore = catalogSynced ? await loadStore({ privateScope: true }) : null;
    json(res, 200, { ok: true, path: "supabase://public", catalogSynced, store: refreshedStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store save failed";
    const friendlyMessage = message.toLowerCase().includes("on conflict do update")
      ? "Store save blocked by duplicate row IDs. Refresh the admin editor and save again."
      : message;
    json(res, 500, { ok: false, error: friendlyMessage });
  }
}

function catalogCompletionReport(products = [], requestedSkus = []) {
  const requested = new Set(requestedSkus.map((sku) => String(sku).trim().toLowerCase()));
  const candidates = products.filter((product) => !requested.size || requested.has(String(product.sku || "").trim().toLowerCase()));
  const items = candidates.map((product) => {
    const issues = recordPublicationIssues(product);
    const partialResearch = product.raw?.publishAfterResearch === true && isResearchPublicationReady(product);
    const published = product.publishStatus === "Published" && product.visibility === "Public" && (!issues.length || partialResearch);
    return {
      id: product.id,
      sku: product.sku,
      artist: product.artist,
      title: product.title,
      published,
      publishedAfterResearch: partialResearch && issues.length > 0,
      enrichmentStatus: product.enrichmentStatus || product.raw?.enrichmentStatus || "",
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

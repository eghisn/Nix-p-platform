import { getSession, json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, loadStore, saveStore, supabaseFetch } from "../_lib/supabase.js";
import { handleAdminOrders } from "../_lib/commerceHandlers.js";
import { readFinanceState, syncFinanceInventoryToCatalog } from "../_lib/financeState.js";
import { getShippingDashboard, saveShippingSettings } from "../_lib/shippingQuotes.js";
import { importPublicTariffSnapshot, refreshRecentTariffs, runShippingMaintenance, syncDestinationsNow } from "../_lib/nixpShippingEngine.js";

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
  if (action === "catalog-sync") {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const session = getSession(req);
    if (!session || !["admin", "finance"].includes(session.workspace)) {
      return json(res, 401, { ok: false, error: "Admin or Finance login required" });
    }
    try {
      const financeState = await readFinanceState();
      await syncFinanceInventoryToCatalog(financeState);
      return json(res, 200, {
        ok: true,
        inventoryStock: financeState.inventoryStock?.length || 0,
        message: "Finance inventory enrichment and catalog sync completed."
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

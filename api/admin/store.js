import { json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, saveStore, supabaseFetch } from "../_lib/supabase.js";
import { handleAdminOrders } from "../_lib/commerceHandlers.js";
import { readFinanceState, syncFinanceInventoryToCatalog } from "../_lib/financeState.js";

export default async function handler(req, res) {
  const action = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("commerceAction");
  if (action === "orders") return handleAdminOrders(req, res);
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
    if (!requireWorkspace(req, res, "admin")) return;
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
    json(res, 200, { ok: true, path: "supabase://public" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Store save failed";
    const friendlyMessage = message.toLowerCase().includes("on conflict do update")
      ? "Store save blocked by duplicate row IDs. Refresh the admin editor and save again."
      : message;
    json(res, 500, { ok: false, error: friendlyMessage });
  }
}

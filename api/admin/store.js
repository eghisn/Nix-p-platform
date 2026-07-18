import { json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, saveStore } from "../_lib/supabase.js";
import { handleAdminOrders } from "../_lib/commerceHandlers.js";

export default async function handler(req, res) {
  if (new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("commerceAction") === "orders") return handleAdminOrders(req, res);
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
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Store save failed" });
  }
}

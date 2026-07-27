import { json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, supabaseFetch } from "../_lib/supabase.js";

export default async function handler(req, res) {
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
    json(res, 200, { ok: true, backups });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Backup history unavailable" });
  }
}

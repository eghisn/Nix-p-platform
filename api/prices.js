import { json } from "./_lib/auth.js";
import { isSupabaseConfigured, verifiedPrices } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isSupabaseConfigured()) return json(res, 503, { ok: false, error: "Supabase is not configured." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    const prices = await verifiedPrices(Array.isArray(body.ids) ? body.ids : []);
    json(res, 200, { ok: true, prices });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Prices unavailable" });
  }
}


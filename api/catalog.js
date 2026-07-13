import { getSession, json } from "./_lib/auth.js";
import { isSupabaseConfigured, loadStore } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isSupabaseConfigured()) return json(res, 503, { ok: false, error: "Supabase is not configured." });
  const privateScope = new URL(req.url, "https://nix-p.com").searchParams.get("scope") === "admin";
  if (privateScope && !getSession(req)) return json(res, 401, { ok: false, error: "Login required" });
  try {
    const store = await loadStore({ privateScope });
    json(res, 200, { ok: true, store });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Catalog unavailable" });
  }
}


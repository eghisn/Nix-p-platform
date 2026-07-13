import { commitPublicStore, isGitHubDeployConfigured } from "../_lib/github.js";
import { json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, saveStore } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  }
  if (!isGitHubDeployConfigured()) {
    return json(res, 503, { ok: false, error: "GitHub deploy token is not configured." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const store = body.store || {};
  try {
    await saveStore(store);
    const github = await commitPublicStore(store, { message: body.message });
    json(res, 200, {
      ok: true,
      message: "Saved to Supabase and committed to GitHub. Vercel will deploy from the GitHub push.",
      github
    });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Deploy failed" });
  }
}

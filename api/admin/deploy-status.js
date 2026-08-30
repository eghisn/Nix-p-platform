import { json, requireWorkspace } from "../_lib/auth.js";
import { githubDeployStatus } from "../_lib/github.js";
import { isSupabaseConfigured } from "../_lib/supabase.js";
import { reconcileCatalogPublicationState } from "../_lib/catalogPublicationReconciliation.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;

  const supabase = {
    configured: isSupabaseConfigured({ requireServiceRole: true }),
    required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    missing: [
      !process.env.SUPABASE_URL ? "SUPABASE_URL" : "",
      !process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : ""
    ].filter(Boolean)
  };
  const github = githubDeployStatus();
  const shouldReconcile = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("reconcile") === "1";
  const reconciliation = supabase.configured && shouldReconcile
    ? await reconcileCatalogPublicationState().catch((error) => ({
        error: error instanceof Error ? error.message : "Publication reconciliation failed."
      }))
    : null;

  json(res, 200, {
    ok: true,
    ready: supabase.configured && github.configured,
    supabase,
    github,
    reconciliation
  });
}

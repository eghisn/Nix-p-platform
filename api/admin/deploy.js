import { commitPublicStore, isGitHubDeployConfigured } from "../_lib/github.js";
import { json, requireWorkspace } from "../_lib/auth.js";
import { isSupabaseConfigured, loadStore, saveStore } from "../_lib/supabase.js";
import { applyCatalogPublicationSafety, recordPublicationIssues } from "../../src/data/catalogPublication.js";
import { readFinanceState, syncFinanceInventoryToCatalog } from "../_lib/financeState.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Supabase service role is not configured." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const store = body.store || {};
  if (body.deploymentSource !== "admin-editor") {
    return json(res, 400, { ok: false, error: "Deploy blocked: use the authenticated Admin editor so current slider and catalog changes are preserved." });
  }
  if (!Array.isArray(store.products) || !Array.isArray(store.artists) || !Array.isArray(store.collections)) {
    return json(res, 400, { ok: false, error: "Deploy requires a complete admin store payload." });
  }
  try {
    // A deploy can introduce products that were not individually saved in this
    // browser session, so synchronize the complete Admin catalog with Finance.
    const safeStore = applyCatalogPublicationSafety(store);
    await saveStore(safeStore, { syncCatalogProducts: true });
    const financeState = await readFinanceState();
    await syncFinanceInventoryToCatalog(financeState, { enrich: true });
    const deployedStore = applyCatalogPublicationSafety(await loadStore({ privateScope: true }));
    const requestedStatusChange = body.statusChange && typeof body.statusChange === "object"
      ? {
          id: String(body.statusChange.id || "").trim(),
          publishStatus: body.statusChange.publishStatus === "Published" ? "Published" : "Draft"
        }
      : null;
    let statusChange = null;
    if (requestedStatusChange?.id) {
      const product = deployedStore.products.find((item) => item.id === requestedStatusChange.id);
      if (!product) {
        return json(res, 404, {
          ok: false,
          error: "Product could not be found after saving. Nothing was deployed.",
          statusChange: { ...requestedStatusChange, actualStatus: "Missing", deployed: false }
        });
      }
      const actualStatus = product.publishStatus === "Published" && product.visibility === "Public" ? "Published" : "Draft";
      const issues = actualStatus === "Published"
        ? []
        : product.raw?.publicationIssues || recordPublicationIssues(product);
      statusChange = {
        ...requestedStatusChange,
        actualStatus,
        deployed: false,
        issues
      };
      if (requestedStatusChange.publishStatus !== actualStatus) {
        return json(res, 409, {
          ok: false,
          error: `Not published. Complete: ${issues.join(", ") || "required publication fields"}.`,
          statusChange: { ...statusChange, blocked: true }
        });
      }
    }
    if (!isGitHubDeployConfigured()) {
      return json(res, 200, {
        ok: true,
        message: "Saved to Supabase. GitHub commit skipped because GITHUB_DEPLOY_TOKEN or GITHUB_TOKEN is not configured.",
        github: { skipped: true, reason: "missing_token" },
        statusChange
      });
    }
    const github = await commitPublicStore(deployedStore, { message: body.message });
    json(res, 200, {
      ok: true,
      message: "Saved to Supabase and committed to GitHub. Vercel will deploy from the GitHub push.",
      github,
      statusChange: statusChange ? { ...statusChange, deployed: true } : null
    });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Deploy failed" });
  }
}

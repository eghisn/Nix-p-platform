import { getSession, json } from "./_lib/auth.js";
import { readFinanceState, syncFinanceInventoryToCatalog } from "./_lib/financeState.js";

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || !["finance", "admin"].includes(session.workspace)) {
    return json(res, 401, { ok: false, error: "Private workspace login required" });
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const state = await readFinanceState();
    await syncFinanceInventoryToCatalog(state, { enrich: true });
    return json(res, 200, {
      ok: true,
      inventoryStock: state.inventoryStock?.length || 0,
      message: "Finance catalog enrichment completed."
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Catalog enrichment failed" });
  }
}

import { getSession, json } from "../_lib/auth.js";
import { readFinanceState, syncFinanceInventoryToCatalog } from "../_lib/financeState.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  const session = getSession(req);
  if (!session || session.workspace !== "admin") return json(res, 401, { ok: false, error: "Admin login required" });
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

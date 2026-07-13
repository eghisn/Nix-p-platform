import { getSession, json } from "./_lib/auth.js";
import { readFinanceState, writeFinanceState } from "./_lib/financeState.js";

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || !["finance", "admin"].includes(session.workspace)) {
    return json(res, 401, { ok: false, error: "Finance login required" });
  }

  try {
    if (req.method === "GET") return json(res, 200, { ok: true, state: await readFinanceState() });
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const state = await writeFinanceState(body.state);
      return json(res, 200, { ok: true, state });
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Finance state unavailable" });
  }
}

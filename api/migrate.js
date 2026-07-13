import { getSession, json } from "./_lib/auth.js";
import { writeFinanceState } from "./_lib/financeState.js";

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || !["finance", "admin"].includes(session.workspace)) {
    return json(res, 401, { ok: false, error: "Finance login required" });
  }
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const state = typeof body.state === "string" ? JSON.parse(body.state) : body.state;
    await writeFinanceState(state);
    return json(res, 200, { ok: true, migrated: true });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Migration failed" });
  }
}

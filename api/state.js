import { getSession, json } from "./_lib/auth.js";
import { readFinanceStateWithVersion, writeFinanceState } from "./_lib/financeState.js";
import { recordSystemEvent } from "./_lib/observability.js";

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || !["finance", "admin"].includes(session.workspace)) {
    return json(res, 401, { ok: false, error: "Finance login required" });
  }

  try {
    if (req.method === "GET") {
      const snapshot = await readFinanceStateWithVersion();
      return json(res, 200, { ok: true, ...snapshot });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const saved = await writeFinanceState(body.state, {
        expectedUpdatedAt: body.updatedAt || null,
        expectedSectionVersions: body.sectionVersions || null,
        changedSections: body.changedSections || null
      });
      return json(res, 200, { ok: true, ...saved, backupId: saved.backupId });
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    await recordSystemEvent({ source: "finance-state-api", req, error });
    return json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Finance state unavailable" });
  }
}

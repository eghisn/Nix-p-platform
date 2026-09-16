import { createSession, hasSessionSecret, json, validLogin } from "../_lib/auth.js";
import { consumeCommerceRateLimit, requestClientAddress } from "../_lib/commerce.js";
import { isSupabaseConfigured } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasSessionSecret()) return json(res, 503, { ok: false, error: "Session signing is not configured." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const workspace = ["admin", "finance", "marketing"].includes(body.workspace) ? body.workspace : "admin";
  if (isSupabaseConfigured({ requireServiceRole: true })) {
    const subject = `${requestClientAddress(req)}:${workspace}`;
    const allowed = await consumeCommerceRateLimit("workspace-login", subject, { limit: 8, windowSeconds: 900 });
    if (!allowed) return json(res, 429, { ok: false, error: "Too many login attempts. Please wait 15 minutes and try again." });
  }
  if (!validLogin(workspace, body.username, body.password)) {
    return json(res, 401, { ok: false, error: "Invalid credentials" });
  }
  createSession(req, res, workspace, body.username);
  json(res, 200, { ok: true, workspace, username: body.username });
}

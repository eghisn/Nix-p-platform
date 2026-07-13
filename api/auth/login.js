import { createSession, json, validLogin } from "../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const workspace = body.workspace === "finance" ? "finance" : "admin";
  if (!validLogin(workspace, body.username, body.password)) {
    return json(res, 401, { ok: false, error: "Invalid credentials" });
  }
  createSession(req, res, workspace, body.username);
  json(res, 200, { ok: true, workspace, username: body.username });
}

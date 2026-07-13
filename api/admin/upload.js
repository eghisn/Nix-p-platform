import { json, requireWorkspace } from "../_lib/auth.js";
import { uploadImage } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!requireWorkspace(req, res, "admin")) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    const image = await uploadImage(body);
    json(res, 200, { ok: true, image });
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Upload failed" });
  }
}


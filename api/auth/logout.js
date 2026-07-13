import { clearSession, json } from "../_lib/auth.js";

export default function handler(req, res) {
  clearSession(res);
  json(res, 200, { ok: true });
}


import { getSession, json } from "../_lib/auth.js";

export default function handler(req, res) {
  const session = getSession(req);
  json(res, 200, {
    authenticated: Boolean(session),
    workspace: session?.workspace || null,
    username: session?.username || null
  });
}


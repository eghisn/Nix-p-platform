import { timingSafeEqual } from "node:crypto";
import { json } from "./_lib/auth.js";
import { expirePendingOrders } from "./_lib/commerce.js";
import { drainNotificationOutbox } from "./_lib/emailNotifications.js";
import { isSupabaseConfigured } from "./_lib/supabase.js";

// This endpoint is only for the scheduler. It must not be reachable without a
// per-environment secret because it may trigger queued customer emails.
export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed." });
  if (!isSupabaseConfigured({ requireServiceRole: true })) return json(res, 503, { ok: false, error: "Commerce maintenance is not configured." });
  if (!validCronSecret(req.headers.authorization, process.env.CRON_SECRET)) return json(res, 401, { ok: false, error: "Unauthorized." });
  try {
    const maintenance = await expirePendingOrders();
    const outbox = await drainNotificationOutbox(50);
    return json(res, 200, { ok: true, maintenance, outbox, checkedAt: new Date().toISOString() });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Commerce maintenance failed." });
  }
}

function validCronSecret(header, secret) {
  const expected = String(secret || "");
  const received = String(header || "").replace(/^Bearer\s+/i, "");
  if (!expected || !received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

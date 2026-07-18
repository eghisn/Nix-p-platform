import { json, requireWorkspace } from "../_lib/auth.js";
import { getOrderRecord } from "../_lib/commerce.js";
import { supabaseFetch } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (!requireWorkspace(req, res, "admin")) return;
  try {
    if (req.method === "GET") {
      const orderId = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("orderId");
      if (orderId) {
        const order = await getOrderRecord(orderId, { includeEvents: true });
        return order ? json(res, 200, { ok: true, order }) : json(res, 404, { ok: false, error: "Order not found." });
      }
      const orders = await supabaseFetch("order_records?select=*&order=created_at.desc", { service: true });
      return json(res, 200, { ok: true, orders });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action !== "update-operation") return json(res, 400, { ok: false, error: "Unsupported order action." });
    const updated = await supabaseFetch("rpc/admin_update_order_operation", {
      method: "POST", service: true,
      body: { p_order_id: String(body.orderId || ""), p_fulfillment_status: body.fulfillmentStatus || null, p_shipping_status: body.shippingStatus || null, p_courier: body.courier || null, p_tracking_number: body.trackingNumber || null, p_note: body.note || null }
    });
    return json(res, 200, { ok: true, order: updated });
  } catch (error) {
    return json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Order action failed." });
  }
}

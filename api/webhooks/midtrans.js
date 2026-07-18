import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "../_lib/auth.js";
import { getOrderRecord, isMidtransConfigured, midtransBaseUrl } from "../_lib/commerce.js";
import { sendOrderPaymentNotification } from "../_lib/emailNotifications.js";
import { supabaseFetch } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!isValidSignature(body)) return json(res, 401, { ok: false, error: "Invalid Midtrans signature." });
    const verified = await fetchMidtransStatus(body.order_id);
    if (String(verified.order_id) !== String(body.order_id)) throw new Error("Midtrans order verification mismatch.");
    const order = await getOrderRecord(verified.order_id);
    if (!order) return json(res, 404, { ok: false, error: "Order not found." });
    const eventKey = String(verified.transaction_id || `${verified.order_id}:${verified.transaction_status}:${verified.transaction_time || ""}`);
    await supabaseFetch("webhook_receipts?on_conflict=provider,event_key", {
      method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal",
      body: [{ provider: "Midtrans", event_key: eventKey, payload: verified, processed_at: new Date().toISOString() }]
    });
    const status = String(verified.transaction_status || "").toLowerCase();
    const fraud = String(verified.fraud_status || "accept").toLowerCase();
    if ((status === "settlement" || status === "capture") && fraud === "accept") {
      const updated = await supabaseFetch("rpc/apply_verified_payment", {
        method: "POST", service: true,
        body: { p_order_id: order.id, p_provider: "Midtrans", p_provider_transaction_id: String(verified.transaction_id || ""), p_provider_order_id: String(verified.order_id || ""), p_amount: Number(verified.gross_amount), p_payload: verified }
      });
      const paidOrder = await getOrderRecord(order.id);
      await sendOrderPaymentNotification(paidOrder || order).catch((error) => console.warn("Paid-order notification not delivered", error.message));
      return json(res, 200, { ok: true, action: "paid", order: updated });
    }
    if (["expire", "cancel", "deny", "failure"].includes(status)) {
      const paymentStatus = status === "expire" ? "Expired" : status === "failure" ? "Failed" : "Failed";
      const orderStatus = status === "expire" ? "Expired" : "Cancelled";
      const updated = await supabaseFetch("rpc/release_order_reservations", {
        method: "POST", service: true,
        body: { p_order_id: order.id, p_order_status: orderStatus, p_payment_status: paymentStatus, p_reason: `Midtrans reported ${status}; reserved stock released.` }
      });
      return json(res, 200, { ok: true, action: "released", order: updated });
    }
    return json(res, 200, { ok: true, action: "recorded", status });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Midtrans webhook failed." });
  }
}

function isValidSignature(body) {
  const actual = String(body.signature_key || "");
  const expected = createHash("sha512").update(`${body.order_id || ""}${body.status_code || ""}${body.gross_amount || ""}${process.env.MIDTRANS_SERVER_KEY}`).digest("hex");
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function fetchMidtransStatus(orderId) {
  const response = await fetch(`${midtransBaseUrl()}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`, accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.status_message || "Could not verify the Midtrans transaction.");
  return payload;
}

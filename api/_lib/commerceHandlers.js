import { createHash, timingSafeEqual } from "node:crypto";
import { json, requireWorkspace } from "./auth.js";
import { expirePendingOrders, getOrderRecord, isMidtransConfigured, midtransBaseUrl } from "./commerce.js";
import { sendOrderPaymentNotification } from "./emailNotifications.js";
import { supabaseFetch } from "./supabase.js";

export async function handleMidtransToken(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured yet." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const orderId = String(body.orderId || "").trim();
    if (!/^order-[A-Za-z0-9_-]{8,96}$/.test(orderId)) return json(res, 400, { ok: false, error: "Invalid order." });
    await expirePendingOrders();
    const order = await getOrderRecord(orderId);
    if (!order) return json(res, 404, { ok: false, error: "Order not found." });
    if (order.payment_status !== "Pending" || order.order_status !== "Active") return json(res, 409, { ok: false, error: "This order is no longer awaiting payment." });
    if (new Date(order.payment_expires_at).getTime() <= Date.now()) return json(res, 409, { ok: false, error: "This order reservation has expired." });
    const existing = await supabaseFetch(`payment_attempts?select=payload&provider=eq.Midtrans&provider_order_id=eq.${encodeURIComponent(order.id)}&limit=1`, { service: true });
    const existingPayload = existing?.[0]?.payload || {};
    if (existingPayload.token && existingPayload.redirectUrl) return json(res, 200, { ok: true, token: existingPayload.token, redirectUrl: existingPayload.redirectUrl, reused: true });
    const customer = order.customer || {};
    const response = await fetch(`${midtransBaseUrl()}/snap/v1/transactions`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        transaction_details: { order_id: order.id, gross_amount: order.grand_total },
        item_details: order.items.map((item) => ({ id: item.sku, price: item.unit_price, quantity: item.quantity, name: [item.artist, item.title, item.size_label].filter(Boolean).join(" - ").slice(0, 50) })),
        customer_details: { first_name: String(customer.name || "NIXP customer").slice(0, 255), email: String(customer.email || "").slice(0, 255), phone: String(customer.whatsapp || "").slice(0, 32) },
        expiry: { unit: "hour", duration: 2 }, custom_field1: order.public_reference
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token) throw new Error(payload.error_messages?.join(" ") || payload.status_message || "Midtrans could not create a payment session.");
    await supabaseFetch("payment_attempts?on_conflict=provider,provider_order_id", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: [{ order_id: order.id, provider: "Midtrans", provider_order_id: order.id, status: "Pending", amount: order.grand_total, payload: { token: payload.token, redirectUrl: payload.redirect_url } }] });
    return json(res, 200, { ok: true, token: payload.token, redirectUrl: payload.redirect_url, expiresAt: order.payment_expires_at });
  } catch (error) { return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Unable to create payment session." }); }
}

export async function handleMidtransWebhook(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!validSignature(body)) return json(res, 401, { ok: false, error: "Invalid Midtrans signature." });
    const verified = await fetchMidtransStatus(body.order_id);
    if (String(verified.order_id) !== String(body.order_id)) throw new Error("Midtrans order verification mismatch.");
    const order = await getOrderRecord(verified.order_id);
    if (!order) return json(res, 404, { ok: false, error: "Order not found." });
    const eventKey = String(verified.transaction_id || `${verified.order_id}:${verified.transaction_status}:${verified.transaction_time || ""}`);
    await supabaseFetch("webhook_receipts?on_conflict=provider,event_key", { method: "POST", service: true, prefer: "resolution=merge-duplicates,return=minimal", body: [{ provider: "Midtrans", event_key: eventKey, payload: verified, processed_at: new Date().toISOString() }] });
    const status = String(verified.transaction_status || "").toLowerCase();
    const fraud = String(verified.fraud_status || "accept").toLowerCase();
    if ((status === "settlement" || status === "capture") && fraud === "accept") {
      const updated = await supabaseFetch("rpc/apply_verified_payment", { method: "POST", service: true, body: { p_order_id: order.id, p_provider: "Midtrans", p_provider_transaction_id: String(verified.transaction_id || ""), p_provider_order_id: String(verified.order_id || ""), p_amount: Number(verified.gross_amount), p_payload: verified } });
      const paidOrder = await getOrderRecord(order.id);
      await sendOrderPaymentNotification(paidOrder || order).catch((error) => console.warn("Paid-order notification not delivered", error.message));
      return json(res, 200, { ok: true, action: "paid", order: updated });
    }
    if (["expire", "cancel", "deny", "failure"].includes(status)) {
      const updated = await supabaseFetch("rpc/release_order_reservations", { method: "POST", service: true, body: { p_order_id: order.id, p_order_status: status === "expire" ? "Expired" : "Cancelled", p_payment_status: status === "expire" ? "Expired" : "Failed", p_reason: `Midtrans reported ${status}; reserved stock released.` } });
      return json(res, 200, { ok: true, action: "released", order: updated });
    }
    return json(res, 200, { ok: true, action: "recorded", status });
  } catch (error) { return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Midtrans webhook failed." }); }
}

export async function handleAdminOrders(req, res) {
  if (!requireWorkspace(req, res, "admin")) return;
  try {
    if (req.method === "GET") {
      const orderId = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("orderId");
      if (orderId) { const order = await getOrderRecord(orderId, { includeEvents: true }); return order ? json(res, 200, { ok: true, order }) : json(res, 404, { ok: false, error: "Order not found." }); }
      return json(res, 200, { ok: true, orders: await supabaseFetch("order_records?select=*&order=created_at.desc", { service: true }) });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action !== "update-operation") return json(res, 400, { ok: false, error: "Unsupported order action." });
    const order = await supabaseFetch("rpc/admin_update_order_operation", { method: "POST", service: true, body: { p_order_id: String(body.orderId || ""), p_fulfillment_status: body.fulfillmentStatus || null, p_shipping_status: body.shippingStatus || null, p_courier: body.courier || null, p_tracking_number: body.trackingNumber || null, p_note: body.note || null } });
    return json(res, 200, { ok: true, order });
  } catch (error) { return json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Order action failed." }); }
}

function validSignature(body) {
  const actual = String(body.signature_key || "");
  const expected = createHash("sha512").update(`${body.order_id || ""}${body.status_code || ""}${body.gross_amount || ""}${process.env.MIDTRANS_SERVER_KEY}`).digest("hex");
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function fetchMidtransStatus(orderId) {
  const response = await fetch(`${midtransBaseUrl()}/v2/${encodeURIComponent(orderId)}/status`, { headers: { authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`, accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.status_message || "Could not verify the Midtrans transaction.");
  return payload;
}

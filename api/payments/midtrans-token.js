import { json } from "../_lib/auth.js";
import { expirePendingOrders, getOrderRecord, isMidtransConfigured, midtransBaseUrl } from "../_lib/commerce.js";
import { supabaseFetch } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured yet." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const orderId = String(body.orderId || "").trim();
    if (!/^order-[A-Za-z0-9_-]{8,96}$/.test(orderId)) return json(res, 400, { ok: false, error: "Invalid order." });
    await expirePendingOrders();
    const order = await getOrderRecord(orderId);
    if (!order) return json(res, 404, { ok: false, error: "Order not found." });
    if (order.payment_status !== "Pending" || order.order_status !== "Active") {
      return json(res, 409, { ok: false, error: "This order is no longer awaiting payment." });
    }
    if (new Date(order.payment_expires_at).getTime() <= Date.now()) {
      return json(res, 409, { ok: false, error: "This order reservation has expired." });
    }

    const providerOrderId = order.id;
    const existing = await supabaseFetch(`payment_attempts?select=payload&provider=eq.Midtrans&provider_order_id=eq.${encodeURIComponent(providerOrderId)}&limit=1`, { service: true });
    const existingPayload = existing?.[0]?.payload || {};
    if (existingPayload.token && existingPayload.redirectUrl) {
      return json(res, 200, { ok: true, token: existingPayload.token, redirectUrl: existingPayload.redirectUrl, reused: true });
    }

    const customer = order.customer || {};
    const request = {
      transaction_details: { order_id: providerOrderId, gross_amount: order.grand_total },
      item_details: order.items.map((item) => ({
        id: item.sku,
        price: item.unit_price,
        quantity: item.quantity,
        name: [item.artist, item.title, item.size_label].filter(Boolean).join(" - ").slice(0, 50)
      })),
      customer_details: {
        first_name: String(customer.name || "NIXP customer").slice(0, 255),
        email: String(customer.email || "").slice(0, 255),
        phone: String(customer.whatsapp || "").slice(0, 32)
      },
      expiry: { unit: "hour", duration: 2 },
      custom_field1: order.public_reference
    };
    const response = await fetch(`${midtransBaseUrl()}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(request)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token) throw new Error(payload.error_messages?.join(" ") || payload.status_message || "Midtrans could not create a payment session.");
    await supabaseFetch("payment_attempts?on_conflict=provider,provider_order_id", {
      method: "POST",
      service: true,
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [{ order_id: order.id, provider: "Midtrans", provider_order_id: providerOrderId, status: "Pending", amount: order.grand_total, payload: { token: payload.token, redirectUrl: payload.redirect_url } }]
    });
    return json(res, 200, { ok: true, token: payload.token, redirectUrl: payload.redirect_url, expiresAt: order.payment_expires_at });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Unable to create payment session." });
  }
}

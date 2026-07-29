import { timingSafeEqual } from "node:crypto";
import { json } from "./_lib/auth.js";
import { consumeCommerceRateLimit, getOrderRecord, requestClientAddress } from "./_lib/commerce.js";
import { createMidtransPaymentSession } from "./_lib/commerceHandlers.js";
import { isSupabaseConfigured, supabaseFetch } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!isSupabaseConfigured({ requireServiceRole: true })) return json(res, 503, { ok: false, error: "Order status is not configured." });
  const url = new URL(req.url || "/", "https://www.nix-p.com");
  const body = req.method === "POST" ? parseBody(req.body) : {};
  const orderId = String(url.searchParams.get("order") || body.orderId || "").trim();
  const token = String(url.searchParams.get("token") || body.token || "").trim();
  if (!/^order-[A-Za-z0-9_-]{8,96}$/.test(orderId) || !/^[a-f0-9]{32,96}$/i.test(token)) {
    return json(res, 400, { ok: false, error: "This order link is invalid." });
  }
  try {
    if (!(await consumeCommerceRateLimit("customer-order-status", `${requestClientAddress(req)}:${orderId}`, { limit: 60, windowSeconds: 900 }))) {
      return json(res, 429, { ok: false, error: "Please wait a moment before checking this order again." });
    }
    const order = await getOrderRecord(orderId);
    if (!order || !sameToken(token, order.customer_access_token)) return json(res, 404, { ok: false, error: "Order not found." });

    if (req.method === "POST") {
      if (body.action !== "start-payment") return json(res, 400, { ok: false, error: "Unsupported order action." });
      const payment = await createMidtransPaymentSession(orderId);
      return json(res, 200, { ok: true, payment, order: customerOrderSummary(order) });
    }
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed." });
    const quotes = await supabaseFetch(`shipping_quotes?select=courier,service,amount,eta,status,created_at,expires_at&order_id=eq.${encodeURIComponent(orderId)}&order=created_at.desc`, { service: true });
    return json(res, 200, { ok: true, order: customerOrderSummary(order), quotes: quotes || [] });
  } catch (error) {
    return json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Order status is unavailable." });
  }
}

function parseBody(body) {
  try {
    return typeof body === "string" ? JSON.parse(body || "{}") : body || {};
  } catch {
    return {};
  }
}

function sameToken(provided, stored) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(stored || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function customerOrderSummary(order) {
  return {
    id: order.id,
    reference: order.public_reference,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    shippingStatus: order.shipping_status,
    shippingMethod: order.shipping_method,
    courier: order.courier,
    trackingNumber: order.tracking_number,
    merchandiseTotal: order.merchandise_total,
    shippingTotal: order.shipping_total,
    total: order.grand_total,
    paymentExpiresAt: order.payment_expires_at,
    createdAt: order.created_at,
    items: (order.items || []).map((item) => ({
      artist: item.artist,
      title: item.title,
      size: item.size_label,
      quantity: item.quantity,
      lineTotal: item.line_total
    }))
  };
}

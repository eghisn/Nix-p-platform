import { supabaseFetch } from "./supabase.js";

export async function expirePendingOrders() {
  return supabaseFetch("rpc/release_expired_orders", { method: "POST", service: true, body: {} });
}

export async function getOrderRecord(orderId, { includeEvents = false } = {}) {
  const encodedId = encodeURIComponent(String(orderId || ""));
  const [orders, lines, events] = await Promise.all([
    supabaseFetch(`order_records?select=*&id=eq.${encodedId}&limit=1`, { service: true }),
    supabaseFetch(`order_lines?select=*&order_id=eq.${encodedId}&order=created_at.asc`, { service: true }),
    includeEvents
      ? supabaseFetch(`order_events?select=*&order_id=eq.${encodedId}&order=created_at.desc`, { service: true })
      : Promise.resolve([])
  ]);
  const order = orders?.[0];
  if (!order) return null;
  return { ...order, items: lines || [], events: events || [] };
}

export function orderSummary(order) {
  return {
    id: order.id,
    publicReference: order.public_reference,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    shippingStatus: order.shipping_status,
    total: order.grand_total,
    paymentExpiresAt: order.payment_expires_at,
    items: order.items || []
  };
}

export function normalizeShippingAddress(value) {
  const source = value && typeof value === "object" ? value : {};
  const clean = (input, limit) => String(input || "").trim().replace(/\s+/g, " ").slice(0, limit);
  return {
    recipient: clean(source.recipient, 160),
    phone: clean(source.phone, 48),
    address1: clean(source.address1, 240),
    address2: clean(source.address2, 240),
    district: clean(source.district, 120),
    city: clean(source.city, 120),
    province: clean(source.province, 120),
    postalCode: clean(source.postalCode, 16),
    country: clean(source.country || "Indonesia", 80)
  };
}

export function midtransBaseUrl() {
  return String(process.env.MIDTRANS_ENV || "sandbox").toLowerCase() === "production"
    ? "https://app.midtrans.com"
    : "https://app.sandbox.midtrans.com";
}

export function isMidtransConfigured() {
  return Boolean(process.env.MIDTRANS_SERVER_KEY);
}

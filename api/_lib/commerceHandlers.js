import { createHash, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { json, requireWorkspace } from "./auth.js";
import { consumeCommerceRateLimit, expirePendingOrders, getOrderRecord, isMidtransConfigured, midtransBaseUrl, requestClientAddress } from "./commerce.js";
import {
  sendCustomerCancellationNotification,
  sendCustomerPaymentConfirmation,
  sendCustomerRefundNotification,
  sendCustomerShippingQuoteNotification,
  sendCustomerShippingNotification,
  sendOrderPaymentNotification,
  sendOrderRefundNotification
} from "./emailNotifications.js";
import { drainNotificationOutbox } from "./emailNotifications.js";
import { supabaseFetch } from "./supabase.js";

export async function handleMidtransToken(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured yet." });
  try {
    if (!(await consumeCommerceRateLimit("midtrans-token", requestClientAddress(req), { limit: 20, windowSeconds: 900 }))) {
      return json(res, 429, { ok: false, error: "Too many payment attempts. Please wait a few minutes and try again." });
    }
    await drainNotificationOutbox(8).catch(() => undefined);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const orderId = String(body.orderId || "").trim();
    const order = await getOrderRecord(orderId);
    if (!order || !validCustomerAccessToken(body.customerToken, order.customer_access_token)) {
      return json(res, 404, { ok: false, error: "Order not found." });
    }
    const payment = await createMidtransPaymentSession(orderId);
    return json(res, 200, { ok: true, ...payment });
  } catch (error) { return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Unable to create payment session." }); }
}

export async function createMidtransPaymentSession(orderId) {
  if (!isMidtransConfigured()) return { available: false, reason: "midtrans-not-configured" };
  if (!/^order-[A-Za-z0-9_-]{8,96}$/.test(orderId)) throw new Error("Invalid order.");
  await expirePendingOrders();
  const order = await getOrderRecord(orderId);
  if (!order) throw new Error("Order not found.");
  if (order.payment_status !== "Pending" || order.order_status !== "Active") throw new Error("This order is no longer awaiting payment.");
  if (new Date(order.payment_expires_at).getTime() <= Date.now()) throw new Error("This order reservation has expired.");

  const claim = await supabaseFetch("rpc/claim_midtrans_payment_session", {
    method: "POST",
    service: true,
    body: { p_order_id: order.id }
  });
  if (claim?.action === "reuse") {
    return { available: true, token: claim.token, redirectUrl: claim.redirectUrl, expiresAt: claim.expiresAt || order.payment_expires_at, reused: true };
  }
  if (claim?.action === "wait") {
    return { available: false, reason: "payment-session-preparing", expiresAt: claim.expiresAt || order.payment_expires_at, retryAfterSeconds: 3 };
  }
  if (!['create', 'recover'].includes(claim?.action)) throw new Error("Payment session could not be claimed.");

  if (claim.action === "recover") {
    const existingProviderPayment = await fetchMidtransStatus(order.id, { allowMissing: true });
    if (existingProviderPayment) {
      await updateMidtransAttempt(order.id, "Provider Pending", {
        providerStatus: String(existingProviderPayment.transaction_status || "unknown"),
        providerTransactionId: String(existingProviderPayment.transaction_id || ""),
        recoveryCheckedAt: new Date().toISOString()
      });
      return { available: false, reason: "payment-session-provider-pending", expiresAt: order.payment_expires_at };
    }
  }

  const customer = order.customer || {};
  const statusUrl = customerOrderStatusUrl(order);
  try {
    const response = await fetch(`${midtransBaseUrl()}/snap/v1/transactions`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        transaction_details: { order_id: order.id, gross_amount: order.grand_total },
        item_details: [
          ...order.items.map((item) => ({ id: item.sku, price: item.unit_price, quantity: item.quantity, name: [item.artist, item.title, item.size_label].filter(Boolean).join(" - ").slice(0, 50) })),
          ...(Number(order.shipping_total || 0) > 0 ? [{ id: "NIXP-SHIPPING", price: Number(order.shipping_total), quantity: 1, name: `${order.courier || "Shipping"} delivery`.slice(0, 50) }] : [])
        ],
        customer_details: { first_name: String(customer.name || "NIXP customer").slice(0, 255), email: String(customer.email || "").slice(0, 255), phone: String(customer.whatsapp || "").slice(0, 32) },
        expiry: { unit: "hour", duration: 1 },
        callbacks: { finish: statusUrl, error: statusUrl },
        custom_field1: order.public_reference
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token || !payload.redirect_url) throw new Error(payload.error_messages?.join(" ") || payload.status_message || "Midtrans could not create a payment session.");
    await updateMidtransAttempt(order.id, "Pending", { token: payload.token, redirectUrl: payload.redirect_url, createdAt: new Date().toISOString() });
    return { available: true, token: payload.token, redirectUrl: payload.redirect_url, expiresAt: order.payment_expires_at };
  } catch (error) {
    await updateMidtransAttempt(order.id, "Creation Failed", { error: error instanceof Error ? error.message : "Midtrans session creation failed.", failedAt: new Date().toISOString() }).catch(() => undefined);
    throw error;
  }
}

export async function handleMidtransWebhook(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured." });
  let eventKey = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!validSignature(body)) return json(res, 401, { ok: false, error: "Invalid Midtrans signature." });
    const verified = await fetchMidtransStatus(body.order_id);
    if (String(verified.order_id) !== String(body.order_id)) throw new Error("Midtrans order verification mismatch.");
    const order = await getOrderRecord(verified.order_id);
    if (!order) return json(res, 404, { ok: false, error: "Order not found." });
    eventKey = midtransWebhookEventKey(verified);
    const claim = await supabaseFetch("rpc/claim_webhook_receipt", { method: "POST", service: true, body: { p_provider: "Midtrans", p_event_key: eventKey, p_payload: verified } });
    if (!claim?.shouldProcess) return json(res, 200, { ok: true, action: "duplicate", status: claim?.status || "Processed" });
    const status = String(verified.transaction_status || "").toLowerCase();
    const fraud = String(verified.fraud_status || "accept").toLowerCase();
    if ((status === "settlement" || status === "capture") && fraud === "accept") {
      const updated = await supabaseFetch("rpc/apply_verified_payment", { method: "POST", service: true, body: { p_order_id: order.id, p_provider: "Midtrans", p_provider_transaction_id: String(verified.transaction_id || ""), p_provider_order_id: String(verified.order_id || ""), p_amount: Number(verified.gross_amount), p_payload: verified } });
      const paidOrder = await getOrderRecord(order.id);
      if (!updated?.idempotent) {
        await Promise.allSettled([
          sendOrderPaymentNotification(paidOrder || order, { queueOnly: true }),
          sendCustomerPaymentConfirmation(paidOrder || order, { queueOnly: true })
        ]);
      }
      await completeWebhookReceipt(eventKey);
      scheduleNotificationOutboxDrain();
      return json(res, 200, { ok: true, action: "paid", order: updated });
    }
    if (["expire", "cancel", "deny", "failure"].includes(status)) {
      const updated = await supabaseFetch("rpc/release_order_reservations", { method: "POST", service: true, body: { p_order_id: order.id, p_order_status: status === "expire" ? "Expired" : "Cancelled", p_payment_status: status === "expire" ? "Expired" : "Failed", p_reason: `Midtrans reported ${status}; reserved stock released.` } });
      const releasedOrder = await getOrderRecord(order.id);
      await sendCustomerCancellationNotification(releasedOrder || order, `Payment provider status: ${status}.`, { queueOnly: true }).catch((error) => console.warn("Customer cancellation email could not be queued", error.message));
      await completeWebhookReceipt(eventKey);
      scheduleNotificationOutboxDrain();
      return json(res, 200, { ok: true, action: "released", order: updated });
    }
    if (["refund", "partial_refund"].includes(status)) {
      const fullRefund = status === "refund";
      const refundAmount = fullRefund ? Number(order.grand_total) : Number(verified.refund_amount || 0);
      const updated = await supabaseFetch("rpc/apply_verified_refund", {
        method: "POST",
        service: true,
        body: {
          p_order_id: order.id,
          p_provider: "Midtrans",
          p_provider_transaction_id: String(verified.transaction_id || ""),
          p_refund_amount: refundAmount,
          p_full_refund: fullRefund,
          p_payload: verified
        }
      });
      const refundedOrder = await getOrderRecord(order.id);
      if (!updated?.idempotent) {
        await Promise.allSettled([
          sendOrderRefundNotification(refundedOrder || order, refundAmount, fullRefund, { queueOnly: true }),
          sendCustomerRefundNotification(refundedOrder || order, refundAmount, fullRefund, { queueOnly: true })
        ]);
      }
      await completeWebhookReceipt(eventKey);
      scheduleNotificationOutboxDrain();
      return json(res, 200, { ok: true, action: fullRefund ? "refunded" : "partially-refunded", order: updated });
    }
    await completeWebhookReceipt(eventKey);
    return json(res, 200, { ok: true, action: "recorded", status });
  } catch (error) {
    if (eventKey) await completeWebhookReceipt(eventKey, false, error instanceof Error ? error.message : "Midtrans webhook failed.").catch(() => undefined);
    return json(res, 500, { ok: false, error: "Midtrans webhook could not be processed." });
  }
}

async function completeWebhookReceipt(eventKey, processed = true, error = null) {
  return supabaseFetch("rpc/complete_webhook_receipt", {
    method: "POST",
    service: true,
    body: { p_provider: "Midtrans", p_event_key: eventKey, p_processed: processed, p_error: error }
  });
}

export async function handleAdminOrders(req, res) {
  if (!requireWorkspace(req, res, "admin")) return;
  try {
    if (req.method === "GET") {
      res.setHeader("cache-control", "private, no-store, max-age=0");
      const orderId = new URL(req.url || "/", "https://admin.nix-p.com").searchParams.get("orderId");
      if (orderId) { const order = await getOrderRecord(orderId, { includeEvents: true }); return order ? json(res, 200, { ok: true, order }) : json(res, 404, { ok: false, error: "Order not found." }); }
      const orders = await supabaseFetch("order_records?select=id,public_reference,customer,metadata,order_status,payment_status,fulfillment_status,shipping_status,shipping_method,courier,tracking_number,merchandise_total,shipping_total,grand_total,payment_expires_at,created_at,updated_at&order=created_at.desc", { service: true });
      return json(res, 200, { ok: true, orders: (orders || []).map(adminOrderListRow) });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    await drainNotificationOutbox(24).catch(() => undefined);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action === "issue-shipping-quote") {
      const quoted = await supabaseFetch("rpc/issue_shipping_quote", {
        method: "POST",
        service: true,
        body: {
          p_order_id: String(body.orderId || ""),
          p_amount: Number(body.amount || 0),
          p_courier: String(body.courier || ""),
          p_service: body.service || null,
          p_eta: body.eta || null
        }
      });
      const after = await getOrderRecord(String(body.orderId || ""));
      if (after) await sendCustomerShippingQuoteNotification(after, customerOrderStatusUrl(after)).catch((error) => console.warn("Customer shipping quote email not delivered", error.message));
      return json(res, 200, { ok: true, order: quoted });
    }
    if (body.action !== "update-operation") return json(res, 400, { ok: false, error: "Unsupported order action." });
    const orderId = String(body.orderId || "");
    const before = await getOrderRecord(orderId);
    const order = await supabaseFetch("rpc/admin_update_order_operation", { method: "POST", service: true, body: { p_order_id: orderId, p_fulfillment_status: body.fulfillmentStatus || null, p_shipping_status: body.shippingStatus || null, p_courier: body.courier || null, p_tracking_number: body.trackingNumber || null, p_note: body.note || null } });
    const after = await getOrderRecord(orderId);
    if (after && (after.shipping_status !== before?.shipping_status || after.tracking_number !== before?.tracking_number)) {
      await sendCustomerShippingNotification(after).catch((error) => console.warn("Customer shipping email not delivered", error.message));
    }
    return json(res, 200, { ok: true, order });
  } catch (error) { return json(res, Number(error?.statusCode || 500), { ok: false, error: error instanceof Error ? error.message : "Order action failed." }); }
}

function customerOrderStatusUrl(order) {
  const base = String(process.env.NIXP_PUBLIC_SITE_URL || "https://www.nix-p.com").replace(/\/$/, "");
  return `${base}/order-status#order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.customer_access_token || "")}`;
}

function validCustomerAccessToken(provided, stored) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(stored || ""));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function validSignature(body) {
  const actual = String(body.signature_key || "");
  const expected = createHash("sha512").update(`${body.order_id || ""}${body.status_code || ""}${body.gross_amount || ""}${process.env.MIDTRANS_SERVER_KEY}`).digest("hex");
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function fetchMidtransStatus(orderId, { allowMissing = false } = {}) {
  const response = await fetch(`${midtransBaseUrl()}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`, accept: "application/json" },
    signal: AbortSignal.timeout(4_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(payload.status_message || "Could not verify the Midtrans transaction.");
  return payload;
}

async function updateMidtransAttempt(orderId, status, payload) {
  return supabaseFetch(`payment_attempts?provider=eq.Midtrans&provider_order_id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    service: true,
    prefer: "return=minimal",
    body: { status, payload }
  });
}

function midtransWebhookEventKey(payload) {
  return [
    payload.order_id,
    payload.transaction_id || "no-transaction",
    payload.transaction_status || "unknown-status",
    payload.fraud_status || "",
    payload.status_code || "",
    payload.gross_amount || "",
    payload.refund_amount || "",
    payload.refund_key || "",
    payload.settlement_time || payload.transaction_time || ""
  ].map((value) => String(value || "").slice(0, 80)).join(":").slice(0, 240);
}

function scheduleNotificationOutboxDrain() {
  try {
    waitUntil(
      drainNotificationOutbox(8).catch((error) => {
        console.warn("Webhook notification delivery deferred", error instanceof Error ? error.message : error);
      })
    );
  } catch (error) {
    console.warn("Webhook notification delivery could not be scheduled", error instanceof Error ? error.message : error);
  }
}

function adminOrderListRow(order) {
  const customer = order?.customer || {};
  return {
    ...order,
    customer: {
      name: String(customer.name || "").slice(0, 160),
      email: String(customer.email || "").slice(0, 254),
      whatsapp: String(customer.whatsapp || "").slice(0, 48)
    }
  };
}

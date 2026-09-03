import { createHash, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { json, requireWorkspace } from "./auth.js";
import { consumeCommerceRateLimit, getOrderRecord, isMidtransConfigured, midtransBaseUrl, midtransConfiguration, requestClientAddress } from "./commerce.js";
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
import { recordSystemEvent } from "./observability.js";
import { supabaseFetch } from "./supabase.js";

export async function handleMidtransToken(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isMidtransConfigured()) return json(res, 503, { ok: false, error: "Midtrans is not configured yet." });
  try {
    if (!(await consumeCommerceRateLimit("midtrans-token", requestClientAddress(req), { limit: 20, windowSeconds: 900 }))) {
      return json(res, 429, { ok: false, error: "Too many payment attempts. Please wait a few minutes and try again." });
    }
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
  const idempotencyKey = midtransIdempotencyKey(order.id);
  const itemDetails = buildMidtransItemDetails(order);
  try {
    await updateMidtransAttempt(order.id, "Creating", {
      idempotencyKey,
      requestStartedAt: new Date().toISOString()
    });
    const response = await fetch(`${midtransBaseUrl()}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json",
        "Idempotency-Key": idempotencyKey
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        transaction_details: { order_id: order.id, gross_amount: order.grand_total },
        item_details: itemDetails,
        customer_details: { first_name: String(customer.name || "NIXP customer").slice(0, 255), email: String(customer.email || "").slice(0, 255), phone: String(customer.whatsapp || "").slice(0, 32) },
        expiry: { unit: "hour", duration: 1 },
        callbacks: { finish: statusUrl, error: statusUrl },
        custom_field1: order.public_reference
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token || !payload.redirect_url) throw new Error(payload.error_messages?.join(" ") || payload.status_message || "Midtrans could not create a payment session.");
    if (!validMidtransRedirectUrl(payload.redirect_url)) throw new Error("Midtrans returned an invalid payment URL.");
    await updateMidtransAttempt(order.id, "Pending", { idempotencyKey, token: payload.token, redirectUrl: payload.redirect_url, createdAt: new Date().toISOString() });
    return { available: true, token: payload.token, redirectUrl: payload.redirect_url, expiresAt: order.payment_expires_at };
  } catch (error) {
    await updateMidtransAttempt(order.id, "Creation Failed", { idempotencyKey, error: error instanceof Error ? error.message : "Midtrans session creation failed.", failedAt: new Date().toISOString() }).catch(() => undefined);
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
    if (isMidtransDashboardNotificationTest(body)) {
      return json(res, 200, { ok: true, action: "test-acknowledged" });
    }
    const verified = await fetchMidtransStatus(body.order_id);
    if (String(verified.order_id) !== String(body.order_id)) throw new Error("Midtrans order verification mismatch.");
    eventKey = midtransWebhookEventKey(verified);
    const result = await processVerifiedMidtransEvent(verified, eventKey);
    return json(res, result.notFound ? 404 : 200, { ok: !result.notFound, ...result });
  } catch (error) {
    if (eventKey) await completeWebhookReceipt(eventKey, false, error instanceof Error ? error.message : "Midtrans webhook failed.").catch(() => undefined);
    await recordSystemEvent({ source: "midtrans-webhook", req, error, details: { eventKey: eventKey || null } });
    return json(res, 500, { ok: false, error: "Midtrans webhook could not be processed." });
  }
}

async function processVerifiedMidtransEvent(verified, eventKey = midtransWebhookEventKey(verified)) {
  const order = await getOrderRecord(verified.order_id);
  if (!order) return { action: "not-found", notFound: true, error: "Order not found." };
  assertVerifiedMidtransIdentity(verified, order);
  const claim = await supabaseFetch("rpc/claim_webhook_receipt", {
    method: "POST",
    service: true,
    body: { p_provider: "Midtrans", p_event_key: eventKey, p_payload: verified }
  });
  if (!claim?.shouldProcess) return { action: "duplicate", status: claim?.status || "Processed" };

  const status = String(verified.transaction_status || "").toLowerCase();
  const fraud = String(verified.fraud_status || "").toLowerCase();
  if ((status === "settlement" || status === "capture") && (!fraud || fraud === "accept")) {
    assertSuccessfulMidtransPayment(verified, order);
    const updated = await supabaseFetch("rpc/apply_verified_payment", {
      method: "POST",
      service: true,
      body: {
        p_order_id: order.id,
        p_provider: "Midtrans",
        p_provider_transaction_id: String(verified.transaction_id || ""),
        p_provider_order_id: String(verified.order_id || ""),
        p_amount: Number(verified.gross_amount),
        p_payload: verified
      }
    });
    const paidOrder = await getOrderRecord(order.id);
    if (!updated?.idempotent) {
      await Promise.allSettled([
        sendOrderPaymentNotification(paidOrder || order, { queueOnly: true }),
        sendCustomerPaymentConfirmation(paidOrder || order, { queueOnly: true })
      ]);
    }
    await completeWebhookReceipt(eventKey);
    scheduleNotificationOutboxDrain();
    return { action: "paid", order: updated };
  }

  if (["expire", "cancel", "deny", "failure"].includes(status)) {
    const updated = await supabaseFetch("rpc/release_order_reservations", {
      method: "POST",
      service: true,
      body: {
        p_order_id: order.id,
        p_order_status: status === "expire" ? "Expired" : "Cancelled",
        p_payment_status: status === "expire" ? "Expired" : "Failed",
        p_reason: `Midtrans reported ${status}; reserved stock released.`
      }
    });
    const releasedOrder = await getOrderRecord(order.id);
    await sendCustomerCancellationNotification(releasedOrder || order, `Payment provider status: ${status}.`, { queueOnly: true })
      .catch((error) => console.warn("Customer cancellation email could not be queued", error.message));
    await completeWebhookReceipt(eventKey);
    scheduleNotificationOutboxDrain();
    return { action: "released", order: updated };
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
    return { action: fullRefund ? "refunded" : "partially-refunded", order: updated };
  }

  await updateMidtransAttempt(order.id, "Provider Pending", {
    providerStatus: status || "unknown",
    providerTransactionId: String(verified.transaction_id || ""),
    verifiedAt: new Date().toISOString()
  });
  await completeWebhookReceipt(eventKey);
  return { action: "recorded", status };
}

export async function reconcilePendingMidtransPayments({ limit = 20, source = "manual" } = {}) {
  if (!isMidtransConfigured()) return { configured: false, checked: 0, changed: 0, failed: 0 };
  const attempts = await supabaseFetch(
    `payment_attempts?select=order_id,status,payload,updated_at&provider=eq.Midtrans&order=updated_at.asc&limit=100`,
    { service: true }
  );
  const eligibleStatuses = new Set(["Creating", "Creation Failed", "Pending", "Provider Pending"]);
  const minimumAge = Date.now() - 30_000;
  const eligible = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => eligibleStatuses.has(attempt.status) && new Date(attempt.updated_at).getTime() <= minimumAge)
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)));
  const summary = { configured: true, checked: 0, changed: 0, missing: 0, failed: 0, source };

  for (const attempt of eligible) {
    const order = await getOrderRecord(attempt.order_id);
    if (!order || order.order_status !== "Active" || order.payment_status !== "Pending") continue;
    summary.checked += 1;
    try {
      const verified = await fetchMidtransStatus(order.id, { allowMissing: true });
      if (!verified) {
        summary.missing += 1;
        continue;
      }
      const result = await processVerifiedMidtransEvent(verified);
      if (!["recorded", "duplicate"].includes(result.action)) summary.changed += 1;
    } catch (error) {
      summary.failed += 1;
      await updateMidtransAttempt(order.id, attempt.status, {
        ...(attempt.payload || {}),
        lastReconciliationError: error instanceof Error ? error.message : "Midtrans reconciliation failed.",
        lastReconciliationAt: new Date().toISOString()
      }).catch(() => undefined);
      await recordSystemEvent({
        source: "midtrans-reconciliation",
        error,
        details: { orderId: order.id, attemptStatus: attempt.status, reconciliationSource: source }
      });
    }
  }
  return summary;
}

export async function getCommerceHealthSnapshot() {
  const configuration = midtransConfiguration();
  const [attempts, receipts, reservations, orders, outbox] = await Promise.all([
    supabaseFetch("payment_attempts?select=order_id,status,updated_at&provider=eq.Midtrans&order=updated_at.desc&limit=100", { service: true }),
    supabaseFetch("webhook_receipts?select=status,last_error,updated_at&provider=eq.Midtrans&order=updated_at.desc&limit=100", { service: true }),
    supabaseFetch("inventory_reservations?select=order_id,status,expires_at&status=eq.Active&order=expires_at.asc&limit=100", { service: true }),
    supabaseFetch("order_records?select=id,public_reference,payment_status,payment_expires_at&payment_status=eq.Pending&order=payment_expires_at.asc&limit=100", { service: true }),
    supabaseFetch("notification_outbox?select=status,updated_at&status=in.(Pending,Failed,Sending)&order=updated_at.asc&limit=100", { service: true })
  ]);
  const now = Date.now();
  const staleAttempts = (attempts || []).filter((row) => ["Creating", "Creation Failed", "Provider Pending"].includes(row.status) && new Date(row.updated_at).getTime() < now - 5 * 60_000);
  const failedWebhooks = (receipts || []).filter((row) => row.status === "Failed");
  const overdueReservations = (reservations || []).filter((row) => new Date(row.expires_at).getTime() < now - 10 * 60_000);
  const overdueOrders = (orders || []).filter((row) => new Date(row.payment_expires_at).getTime() < now - 10 * 60_000);
  const failedOutbox = (outbox || []).filter((row) => row.status === "Failed");
  const issues = [];
  if (!configuration.enabled) issues.push("Midtrans payments are disabled by the launch switch.");
  if (configuration.enabled && !configuration.hasMerchantId) issues.push("Midtrans merchant ID is missing.");
  if (configuration.enabled && !configuration.hasServerKey) issues.push("Midtrans server key is missing.");
  if (staleAttempts.length) issues.push(`${staleAttempts.length} payment attempt${staleAttempts.length === 1 ? " is" : "s are"} stuck.`);
  if (failedWebhooks.length) issues.push(`${failedWebhooks.length} Midtrans webhook${failedWebhooks.length === 1 ? " has" : "s have"} failed.`);
  if (overdueReservations.length || overdueOrders.length) issues.push(`${Math.max(overdueReservations.length, overdueOrders.length)} expired order reservation${Math.max(overdueReservations.length, overdueOrders.length) === 1 ? " needs" : "s need"} cleanup.`);
  if (failedOutbox.length) issues.push(`${failedOutbox.length} order notification${failedOutbox.length === 1 ? " has" : "s have"} failed delivery.`);
  return {
    ok: configuration.ready && issues.length === 0,
    configuration,
    counts: {
      pendingPayments: (orders || []).length,
      activeReservations: (reservations || []).length,
      staleAttempts: staleAttempts.length,
      failedWebhooks: failedWebhooks.length,
      overdueReservations: Math.max(overdueReservations.length, overdueOrders.length),
      failedNotifications: failedOutbox.length
    },
    issues,
    checkedAt: new Date().toISOString()
  };
}

function assertVerifiedMidtransIdentity(verified, order) {
  if (String(verified.order_id || "") !== String(order.id)) throw new Error("Midtrans order verification mismatch.");
  const configuredMerchant = String(process.env.MIDTRANS_MERCHANT_ID || "").trim();
  const providerMerchant = String(verified.merchant_id || "").trim();
  if (configuredMerchant && providerMerchant && configuredMerchant !== providerMerchant) throw new Error("Midtrans merchant verification mismatch.");
  const currency = String(verified.currency || "IDR").toUpperCase();
  if (currency !== "IDR") throw new Error("Midtrans transaction currency mismatch.");
}

function assertSuccessfulMidtransPayment(verified, order) {
  if (String(verified.status_code || "") !== "200") throw new Error("Midtrans did not verify a successful payment status code.");
  const amount = Number(verified.gross_amount);
  if (!Number.isInteger(amount) || amount !== Number(order.grand_total)) throw new Error("Midtrans payment amount does not match the order total.");
}

function midtransIdempotencyKey(orderId) {
  return `nixp-snap-${createHash("sha256").update(`midtrans:${orderId}`).digest("hex").slice(0, 48)}`;
}

function buildMidtransItemDetails(order) {
  const details = (order.items || []).map((item, index) => {
    const price = Number(item.unit_price);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(price) || price <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Order contains an item that is not ready for online payment.");
    }
    const identity = [item.sku, item.size_label, index + 1]
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .join("-")
      .replace(/[^A-Za-z0-9_.~-]+/g, "-")
      .slice(0, 50);
    return {
      id: identity || `NIXP-ITEM-${index + 1}`,
      price,
      quantity,
      name: [item.artist, item.title, item.size_label].filter(Boolean).join(" - ").slice(0, 50)
    };
  });
  const shipping = Number(order.shipping_total || 0);
  if (!Number.isInteger(shipping) || shipping < 0) throw new Error("Order shipping total is invalid.");
  if (shipping > 0) {
    details.push({ id: "NIXP-SHIPPING", price: shipping, quantity: 1, name: `${order.courier || "Shipping"} delivery`.slice(0, 50) });
  }
  const detailTotal = details.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!Number.isInteger(order.grand_total) || detailTotal !== Number(order.grand_total)) {
    throw new Error("Order total does not match its Midtrans payment details.");
  }
  return details;
}

function validMidtransRedirectUrl(value) {
  try {
    return new URL(String(value || "")).origin === new URL(midtransBaseUrl()).origin;
  } catch {
    return false;
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
      const url = new URL(req.url || "/", "https://admin.nix-p.com");
      if (url.searchParams.get("health") === "1") {
        return json(res, 200, { ok: true, health: await getCommerceHealthSnapshot() });
      }
      const orderId = url.searchParams.get("orderId");
      if (orderId) { const order = await getOrderRecord(orderId, { includeEvents: true }); return order ? json(res, 200, { ok: true, order }) : json(res, 404, { ok: false, error: "Order not found." }); }
      const orders = await supabaseFetch("order_records?select=id,public_reference,customer,metadata,order_status,payment_status,fulfillment_status,shipping_status,shipping_method,courier,tracking_number,merchandise_total,shipping_total,grand_total,payment_expires_at,created_at,updated_at&order=created_at.desc", { service: true });
      return json(res, 200, { ok: true, orders: (orders || []).map(adminOrderListRow) });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    await drainNotificationOutbox(24).catch(() => undefined);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action === "reconcile-payments") {
      const reconciliation = await reconcilePendingMidtransPayments({ limit: 30, source: "admin" });
      return json(res, 200, { ok: true, reconciliation, health: await getCommerceHealthSnapshot() });
    }
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

function isMidtransDashboardNotificationTest(body) {
  const merchantId = String(process.env.MIDTRANS_MERCHANT_ID || "").trim();
  if (!merchantId || String(body.merchant_id || "").trim() !== merchantId) return false;
  return String(body.order_id || "").startsWith(`payment_notif_test_${merchantId}_`);
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

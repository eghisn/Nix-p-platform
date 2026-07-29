import { json } from "./_lib/auth.js";
import { consumeCommerceRateLimit, expirePendingOrders, getOrderRecord, normalizeShippingAddress, requestClientAddress } from "./_lib/commerce.js";
import { createMidtransPaymentSession, handleMidtransToken, handleMidtransWebhook } from "./_lib/commerceHandlers.js";
import { drainNotificationOutbox, sendCustomerOrderConfirmation, sendOrderNotification } from "./_lib/emailNotifications.js";
import { isSupabaseConfigured, supabaseFetch } from "./_lib/supabase.js";
import { indonesiaRegencies } from "../src/data/indonesiaRegencies.js";

export default async function handler(req, res) {
  const action = new URL(req.url || "/", "https://nix-p.com").searchParams.get("commerceAction");
  if (action === "midtrans-token") return handleMidtransToken(req, res);
  if (action === "midtrans-webhook") return handleMidtransWebhook(req, res);
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Checkout is not configured." });
  }

  try {
    if (!isCheckoutOrigin(req)) return json(res, 403, { ok: false, error: "Checkout origin is not allowed." });
    const body = parseBody(req.body);
    if (containsClientPrice(body)) {
      return json(res, 400, { ok: false, error: "Checkout prices must be verified by the server." });
    }
    const items = normalizeItems(body.items);
    if (!items.length) return json(res, 400, { ok: false, error: "Cart is empty." });

    const orderId = normalizeOrderId(body.orderId);
    const customer = normalizeCustomer(body.customer);
    const shippingMethod = normalizeShippingMethod(body.shippingMethod);
    const shippingAddress = normalizeShippingAddress(body.shippingAddress);
    validateCheckoutDetails(customer, shippingMethod, shippingAddress);
    await drainNotificationOutbox(8).catch(() => undefined);
    await expirePendingOrders();
    const existingOrder = await getOrderRecord(orderId);
    if (!existingOrder && !(await consumeCommerceRateLimit("checkout-submit", `${requestClientAddress(req)}:${customer.email.toLowerCase()}`, { limit: 8, windowSeconds: 900 }))) {
      return json(res, 429, { ok: false, error: "Too many checkout attempts. Please wait a few minutes and try again." });
    }
    const order = await supabaseFetch("rpc/create_checkout_order", {
      method: "POST",
      service: true,
      body: {
        p_order_id: orderId,
        p_customer: customer,
        p_items: items,
        p_shipping_address: shippingAddress,
        p_shipping_method: shippingMethod
      }
    });
    const currentOrder = await getOrderRecord(orderId);
    const emailResult = (label) => (error) => ({ delivered: false, label, error: error instanceof Error ? error.message : "Notification delivery failed." });
    const [internal, customerConfirmation] = existingOrder
      ? [{ delivered: true, reason: "existing-order" }, { delivered: true, reason: "existing-order" }]
      : await Promise.all([
          sendOrderNotification(currentOrder || order, customer).catch(emailResult("internal")),
          sendCustomerOrderConfirmation(currentOrder || order, customer, { shippingMethod, shippingAddress }).catch(emailResult("customer"))
        ]);
    const notification = { internal, customer: customerConfirmation };
    if (!internal.delivered) console.warn("Internal order notification not delivered", { orderId: order.id, reason: internal.reason || internal.error || "unknown" });
    if (!customerConfirmation.delivered) console.warn("Customer order confirmation not delivered", { orderId: order.id, reason: customerConfirmation.reason || customerConfirmation.error || "unknown" });

    let payment = { available: false, reason: "midtrans-not-configured" };
    if ((currentOrder || order).payment_status === "Pending" || order.paymentStatus === "Pending") {
      try {
        payment = await createMidtransPaymentSession(orderId);
      } catch (paymentError) {
        payment = { available: false, error: paymentError instanceof Error ? paymentError.message : "Unable to start the payment session." };
      }
    }

    return json(res, 200, {
      ok: true,
      notification,
      payment,
      order: {
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus || currentOrder?.payment_status || null,
        fulfillmentStatus: order.fulfillmentStatus || currentOrder?.fulfillment_status || null,
        shippingStatus: order.shippingStatus || currentOrder?.shipping_status || null,
        paymentExpiresAt: order.paymentExpiresAt || currentOrder?.payment_expires_at || null,
        total: order.total,
        items: order.items
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed.";
    const status = message.startsWith("OUT_OF_STOCK") || message.startsWith("ITEM_UNAVAILABLE") || message.startsWith("SIZE_")
      ? 409
      : Number(error?.statusCode || 500);
    return json(res, status, { ok: false, error: friendlyError(message) });
  }
}

function parseBody(body) {
  try {
    return typeof body === "string" ? JSON.parse(body || "{}") : body || {};
  } catch {
    const error = new Error("Invalid checkout payload.");
    error.statusCode = 400;
    throw error;
  }
}

function containsClientPrice(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase();
    if (["price", "total", "linetotal", "subtotal", "amount"].includes(normalized)) return true;
    return containsClientPrice(nested);
  });
}

function normalizeItems(items) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item === "string" ? item : String(item?.id || "");
    const size = typeof item === "string" ? "" : String(item?.size || "").trim();
    const quantity = typeof item === "string" ? 1 : Number(item?.quantity || 1);
    if (!id || !Number.isFinite(quantity) || quantity <= 0) continue;
    const key = `${id}::${size}`;
    counts.set(key, {
      id,
      size,
      quantity: (counts.get(key)?.quantity || 0) + Math.min(20, Math.floor(quantity))
    });
  }
  return [...counts.values()];
}

function normalizeOrderId(value) {
  const token = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(token)) {
    const error = new Error("Invalid checkout session. Please try again.");
    error.statusCode = 400;
    throw error;
  }
  return `order-${token}`;
}

function normalizeCustomer(customer) {
  return {
    name: cleanText(customer?.name, 160),
    email: cleanText(customer?.email, 254),
    whatsapp: cleanText(customer?.whatsapp, 48),
    notes: cleanText(customer?.notes, 2000)
  };
}

function normalizeShippingMethod(value) {
  const method = cleanText(value, 80);
  if (!["JNE", "GoSend Manual", "Store Pickup"].includes(method)) {
    const error = new Error("Please choose a valid shipping method.");
    error.statusCode = 400;
    throw error;
  }
  return method;
}

function validateCheckoutDetails(customer, shippingMethod, address) {
  if (!customer.name) throwCheckoutError("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throwCheckoutError("Please enter a valid email address.");
  if (!customer.whatsapp) throwCheckoutError("Please enter a WhatsApp number.");
  if (shippingMethod === "Store Pickup") return;
  if (address.country !== "Indonesia") throwCheckoutError("Online checkout is currently available for delivery within Indonesia only.");
  for (const [key, label] of [
    ["recipient", "recipient name"],
    ["phone", "recipient phone"],
    ["address1", "address"],
    ["district", "district"],
    ["city", "city or regency"],
    ["province", "province"]
  ]) {
    if (!address[key]) throwCheckoutError(`Please enter the ${label}.`);
  }
  const region = indonesiaRegencies.find((item) => item.code === address.regionCode);
  if (!region || region.city !== address.city || region.province !== address.province) {
    throwCheckoutError("Please select a valid Indonesian city or regency.");
  }
  if (!/^\d{5}$/.test(address.postalCode)) throwCheckoutError("Please enter a valid 5-digit Indonesian postal code.");
}

function throwCheckoutError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function cleanText(value, limit) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function friendlyError(message) {
  if (message.startsWith("OUT_OF_STOCK")) return "One or more selected items are no longer available in that quantity.";
  if (message.startsWith("ITEM_UNAVAILABLE")) return "One or more cart items are no longer available.";
  if (message.startsWith("SIZE_REQUIRED")) return "Please select a size before submitting your order.";
  if (message.startsWith("SIZE_UNAVAILABLE")) return "The selected size is no longer available.";
  if (message === "CART_EMPTY") return "Cart is empty.";
  return message;
}

function isCheckoutOrigin(req) {
  const origin = String(req.headers?.origin || "").replace(/\/$/, "");
  if (!origin) return true;
  return [
    "https://nix-p.com",
    "https://www.nix-p.com",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:4174",
    "http://127.0.0.1:4174"
  ].includes(origin);
}

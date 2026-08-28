import { timingSafeEqual } from "node:crypto";
import { json } from "./_lib/auth.js";
import { consumeCommerceRateLimit, expirePendingOrders, getOrderRecord, normalizeShippingAddress, requestClientAddress } from "./_lib/commerce.js";
import { createMidtransPaymentSession, handleMidtransToken, handleMidtransWebhook } from "./_lib/commerceHandlers.js";
import { drainNotificationOutbox, sendCustomerOrderConfirmation, sendCustomerShippingQuoteNotification, sendCustomerShippingQuoteRequest, sendOrderNotification } from "./_lib/emailNotifications.js";
import { isSupabaseConfigured, supabaseFetch } from "./_lib/supabase.js";
import { calculateRuleShippingQuote, validateRuleShippingQuote } from "./_lib/shippingQuotes.js";
import { runShippingMaintenance } from "./_lib/nixpShippingEngine.js";
import { processCatalogResearchJobs, readFinanceState, syncFinanceInventoryToCatalog } from "./_lib/financeState.js";
import { indonesiaRegencies } from "../src/data/indonesiaRegencies.js";
import { recordSystemEvent } from "./_lib/observability.js";

export default async function handler(req, res) {
  const action = new URL(req.url || "/", "https://nix-p.com").searchParams.get("commerceAction");
  if (action === "midtrans-token") return handleMidtransToken(req, res);
  if (action === "midtrans-webhook") return handleMidtransWebhook(req, res);
  if (action === "order-status") return handleCustomerOrderStatus(req, res);
  if (action === "maintenance") return handleCommerceMaintenance(req, res);
  if (action === "shipping-quote") return handleRuleShippingQuote(req, res);
  if (action === "shipping-destinations") return handleShippingDestinationSearch(req, res);
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
    const ruleQuote = shippingMethod === "JNE"
      ? await validateRuleShippingQuote({ quoteToken: cleanText(body.shippingQuoteToken, 160), items, destinationCode: shippingAddress.regionCode, optionKey: cleanText(body.shippingOption, 180) })
      : null;
    const manualShippingQuote = shippingMethod === "GoSend Manual";
    const usesShippingQuoteFlow = shippingMethod === "JNE" || manualShippingQuote;
    let order = await supabaseFetch(usesShippingQuoteFlow ? "rpc/create_shipping_quote_request" : "rpc/create_checkout_order", {
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
    let orderBeforeQuote = await getOrderRecord(orderId);
    if (ruleQuote?.selectedOption && orderBeforeQuote?.order_status === "Draft" && orderBeforeQuote?.shipping_status === "Awaiting Quote") {
      const option = ruleQuote.selectedOption;
      const packages = ruleQuote.packaging.packages.map((pkg) => {
        const rate = option.packageRates.find((entry) => entry.packageNumber === pkg.packageNumber);
        return { ...pkg, rateId: rate?.rateId || null, shippingAmount: rate?.amount || 0 };
      });
      order = await supabaseFetch("rpc/issue_rule_based_shipping_quote", {
        method: "POST",
        service: true,
        body: {
          p_order_id: orderId,
          p_amount: option.shippingTotal,
          p_courier: option.courier,
          p_service: option.service,
          p_eta: option.eta || null,
          p_packages: packages,
          p_rate_ids: option.packageRates.map((entry) => entry.rateId),
          p_calculator_version: ruleQuote.packaging.calculatorVersion
        }
      });
    }
    const currentOrder = await getOrderRecord(orderId);
    const emailResult = (label) => (error) => ({ delivered: false, label, error: error instanceof Error ? error.message : "Notification delivery failed." });
    const customerAccessToken = order.customerAccessToken || currentOrder?.customer_access_token || "";
    const statusUrl = customerAccessToken ? customerOrderStatusUrl(orderId, customerAccessToken) : "";
    const [internal, customerConfirmation] = existingOrder
      ? [{ delivered: true, reason: "existing-order" }, { delivered: true, reason: "existing-order" }]
      : await Promise.all([
          sendOrderNotification(currentOrder || order, customer).catch(emailResult("internal")),
          (manualShippingQuote
            ? sendCustomerShippingQuoteRequest(currentOrder || order, customer, statusUrl)
            : shippingMethod === "JNE"
              ? sendCustomerShippingQuoteNotification(currentOrder || order, statusUrl)
            : sendCustomerOrderConfirmation(currentOrder || order, customer, { shippingMethod, shippingAddress })
          ).catch(emailResult("customer"))
        ]);
    const notification = { internal, customer: customerConfirmation };
    if (!internal.delivered) console.warn("Internal order notification not delivered", { orderId: order.id, reason: internal.reason || internal.error || "unknown" });
    if (!customerConfirmation.delivered) console.warn("Customer order confirmation not delivered", { orderId: order.id, reason: customerConfirmation.reason || customerConfirmation.error || "unknown" });

    let payment = { available: false, reason: "midtrans-not-configured" };
    if (!manualShippingQuote && ((currentOrder || order).payment_status === "Pending" || order.paymentStatus === "Pending")) {
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
      requiresShippingQuote: manualShippingQuote,
      shippingQuote: ruleQuote?.selectedOption || null,
      customerAccessToken,
      statusUrl,
      order: {
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus || currentOrder?.payment_status || null,
        fulfillmentStatus: order.fulfillmentStatus || currentOrder?.fulfillment_status || null,
        shippingStatus: order.shippingStatus || currentOrder?.shipping_status || null,
        paymentExpiresAt: order.paymentExpiresAt || currentOrder?.payment_expires_at || null,
        merchandiseTotal: order.merchandiseTotal || currentOrder?.merchandise_total || order.total,
        shippingTotal: order.shippingTotal || currentOrder?.shipping_total || 0,
        total: order.total,
        items: order.items
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed.";
    const status = message.startsWith("OUT_OF_STOCK") || message.startsWith("ITEM_UNAVAILABLE") || message.startsWith("SIZE_")
      ? 409
      : Number(error?.statusCode || 500);
    await recordSystemEvent({ source: "checkout-api", req, error, details: { action: action || "checkout", status } });
    return json(res, status, { ok: false, error: friendlyError(message) });
  }
}

async function handleRuleShippingQuote(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isSupabaseConfigured({ requireServiceRole: true })) return json(res, 503, { ok: false, error: "Shipping quotes are not configured." });
  try {
    if (!isCheckoutOrigin(req)) return json(res, 403, { ok: false, error: "Checkout origin is not allowed." });
    const body = parseBody(req.body);
    if (!(await consumeCommerceRateLimit("shipping-quote", requestClientAddress(req), { limit: 90, windowSeconds: 900 }))) {
      return json(res, 429, { ok: false, error: "Too many shipping quote requests. Please wait a moment and try again." });
    }
    const quote = await calculateRuleShippingQuote({ items: normalizeItems(body.items), destinationCode: body.destinationCode });
    return json(res, 200, {
      ok: true,
      destination: quote.destination,
      calculatorVersion: quote.packaging.calculatorVersion,
      totalChargeableWeightKg: quote.packaging.totalChargeableWeightKg,
      packages: quote.packaging.packages,
      options: quote.options,
      quoteToken: quote.quoteToken,
      expiresAt: quote.expiresAt,
      quotedAt: quote.quotedAt
    });
  } catch (error) {
    await recordSystemEvent({ source: "shipping-quote-api", req, error });
    return json(res, Number(error?.statusCode || 500), { ok: false, error: friendlyError(error instanceof Error ? error.message : "Shipping quote failed.") });
  }
}

async function handleShippingDestinationSearch(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  try {
    if (!isCheckoutOrigin(req)) return json(res, 403, { ok: false, error: "Checkout origin is not allowed." });
    if (!(await consumeCommerceRateLimit("shipping-destinations", requestClientAddress(req), { limit: 120, windowSeconds: 900 }))) return json(res, 429, { ok: false, error: "Too many destination searches." });
    const query = normalizeSearchText(new URL(req.url || "/", "https://www.nix-p.com").searchParams.get("q") || "");
    if (query.length < 3) return json(res, 200, { ok: true, destinations: [] });
    const rows = await supabaseFetch("jne_destinations?select=local_region_code,jne_destination_code,destination_name,province_name,city_or_regency_name,district_name,subdistrict_name,postal_code,normalized_search_text&active=eq.true&limit=1000", { service: true });
    const destinations = (rows || [])
      .filter((row) => normalizeSearchText(row.normalized_search_text || [row.destination_name, row.city_or_regency_name, row.province_name, row.district_name, row.subdistrict_name, row.postal_code].filter(Boolean).join(" ")).includes(query))
      .slice(0, 30)
      .map((row) => ({
        localRegionCode: row.local_region_code,
        jneDestinationCode: row.jne_destination_code,
        provinceName: row.province_name,
        cityName: row.city_or_regency_name || row.destination_name,
        districtName: row.district_name,
        subdistrictName: row.subdistrict_name,
        postalCode: row.postal_code,
        displayName: [row.city_or_regency_name || row.destination_name, row.province_name].filter(Boolean).join(", ")
      }));
    return json(res, 200, { ok: true, destinations });
  } catch (error) {
    return json(res, Number(error?.statusCode || 503), { ok: false, error: error instanceof Error ? error.message : "Destination search unavailable." });
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function handleCustomerOrderStatus(req, res) {
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

async function handleCommerceMaintenance(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed." });
  if (!isSupabaseConfigured({ requireServiceRole: true })) return json(res, 503, { ok: false, error: "Commerce maintenance is not configured." });
  if (!validCronSecret(req.headers.authorization, process.env.CRON_SECRET)) return json(res, 401, { ok: false, error: "Unauthorized." });
  try {
    // Release first. Reconciliation reads active reservations, so it must not
    // race the release transaction and publish an intermediate stock count.
    const maintenance = await expirePendingOrders();
    const financeState = await readFinanceState();
    const [outbox, shipping, catalog, research] = await Promise.all([
      drainNotificationOutbox(50),
      runShippingMaintenance({ mode: "daily" }),
      syncFinanceInventoryToCatalog(financeState, { enrich: false }).then(() => ({ inventoryStock: financeState.inventoryStock?.length || 0 })),
      processCatalogResearchJobs({ limit: 2, requestedBy: "maintenance" })
    ]);
    return json(res, 200, { ok: true, maintenance, outbox, shipping, catalog, research, checkedAt: new Date().toISOString() });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Commerce maintenance failed." });
  }
}

function sameToken(provided, stored) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(stored || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function validCronSecret(header, secret) {
  const expected = String(secret || "");
  const received = String(header || "").replace(/^Bearer\s+/i, "");
  if (!expected || !received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
    items: (order.items || []).map((item) => ({ artist: item.artist, title: item.title, size: item.size_label, quantity: item.quantity, lineTotal: item.line_total }))
  };
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

function customerOrderStatusUrl(orderId, token) {
  const base = String(process.env.NIXP_PUBLIC_SITE_URL || "https://www.nix-p.com").replace(/\/$/, "");
  return `${base}/order-status?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`;
}

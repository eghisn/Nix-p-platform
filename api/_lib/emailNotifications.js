import nodemailer from "nodemailer";

const DEFAULT_TO = "contact@nix-p.com";
const DEFAULT_FROM = "NIXP <contact@nix-p.com>";

export async function sendRequestNotification(request) {
  return sendNotificationEmail({
    subject: `NIXP request item: ${request.artistName} - ${request.itemName}`,
    replyTo: request.email,
    text: requestEmailText(request),
    html: requestEmailHtml(request),
    idempotencyKey: `request-notification-${request.id}`
  });
}

export async function sendOrderNotification(order, customer = {}) {
  return sendNotificationEmail({
    subject: `NIXP order: ${order.id} - ${rupiah(order.total)}`,
    replyTo: customer.email,
    text: orderEmailText(order, customer),
    html: orderEmailHtml(order, customer),
    idempotencyKey: `order-notification-${order.id}`
  });
}

export async function sendCustomerOrderConfirmation(order, customer = {}, delivery = {}) {
  if (!customer.email) return { delivered: false, reason: "customer-email-missing" };
  const reference = orderReference(order);
  return sendNotificationEmail({
    to: customer.email,
    subject: `NIXP order received: ${reference}`,
    replyTo: DEFAULT_TO,
    text: customerOrderText(order, customer, delivery),
    html: customerOrderHtml(order, customer, delivery),
    idempotencyKey: `customer-order-confirmation-${order.id}`
  });
}

export async function sendOrderPaymentNotification(order) {
  const customer = order?.customer || {};
  return sendNotificationEmail({
    subject: `NIXP payment verified: ${order?.public_reference || order?.id}`,
    replyTo: customer.email,
    text: [
      "NIXP payment verified",
      `Order: ${order?.public_reference || order?.id}`,
      `Official total: ${rupiah(order?.grand_total)}`,
      `Payment: ${order?.payment_status}`,
      `Fulfillment: ${order?.fulfillment_status}`,
      `Shipping: ${order?.shipping_status}`
    ].join("\n"),
    html: `<h1>NIXP payment verified</h1><p><strong>Order:</strong> ${escapeHtml(order?.public_reference || order?.id)}<br><strong>Official total:</strong> ${escapeHtml(rupiah(order?.grand_total))}<br><strong>Payment:</strong> ${escapeHtml(order?.payment_status)}<br><strong>Fulfillment:</strong> ${escapeHtml(order?.fulfillment_status)}<br><strong>Shipping:</strong> ${escapeHtml(order?.shipping_status)}</p>`,
    idempotencyKey: `paid-order-notification-${order?.id}`
  });
}

export async function sendCustomerPaymentConfirmation(order) {
  const customer = order?.customer || {};
  if (!customer.email) return { delivered: false, reason: "customer-email-missing" };
  return sendNotificationEmail({
    to: customer.email,
    subject: `NIXP payment confirmed: ${orderReference(order)}`,
    replyTo: DEFAULT_TO,
    text: statusEmailText(order, "Payment confirmed", "We have securely verified your payment. Your order is now being prepared."),
    html: statusEmailHtml(order, "Payment confirmed", "We have securely verified your payment. Your order is now being prepared."),
    idempotencyKey: `customer-payment-confirmation-${order?.id}`
  });
}

export async function sendCustomerShippingNotification(order) {
  const customer = order?.customer || {};
  if (!customer.email) return { delivered: false, reason: "customer-email-missing" };
  const delivered = order?.shipping_status === "Delivered";
  const message = delivered
    ? "Your order has been marked as delivered."
    : `Your order shipping status is now ${order?.shipping_status || "updated"}.${order?.tracking_number ? ` Tracking number: ${order.tracking_number}.` : ""}`;
  return sendNotificationEmail({
    to: customer.email,
    subject: `NIXP ${delivered ? "order delivered" : "shipping update"}: ${orderReference(order)}`,
    replyTo: DEFAULT_TO,
    text: statusEmailText(order, delivered ? "Order delivered" : "Shipping update", message),
    html: statusEmailHtml(order, delivered ? "Order delivered" : "Shipping update", message),
    idempotencyKey: `customer-shipping-${order?.id}-${slug(order?.shipping_status)}-${slug(order?.tracking_number)}`
  });
}

export async function sendCustomerCancellationNotification(order, reason = "") {
  const customer = order?.customer || {};
  if (!customer.email) return { delivered: false, reason: "customer-email-missing" };
  const expired = order?.order_status === "Expired" || order?.payment_status === "Expired";
  const title = expired ? "Order expired" : "Order cancelled";
  const message = expired
    ? "The two-hour payment window ended before payment was verified. Reserved stock has been released."
    : `This order was cancelled and its reserved stock was released.${reason ? ` ${reason}` : ""}`;
  return sendNotificationEmail({
    to: customer.email,
    subject: `NIXP ${title.toLowerCase()}: ${orderReference(order)}`,
    replyTo: DEFAULT_TO,
    text: statusEmailText(order, title, message),
    html: statusEmailHtml(order, title, message),
    idempotencyKey: `customer-${expired ? "expired" : "cancelled"}-${order?.id}`
  });
}

export async function sendCustomerRefundNotification(order, refundAmount, fullRefund = true) {
  const customer = order?.customer || {};
  if (!customer.email) return { delivered: false, reason: "customer-email-missing" };
  return sendNotificationEmail({
    to: customer.email,
    subject: `NIXP ${fullRefund ? "refund" : "partial refund"} completed: ${orderReference(order)}`,
    replyTo: DEFAULT_TO,
    text: statusEmailText(order, fullRefund ? "Refund completed" : "Partial refund completed", `${rupiah(refundAmount)} has been confirmed as refunded by the payment provider. Returned products are not placed back into available stock until NIXP inspects them.`),
    html: statusEmailHtml(order, fullRefund ? "Refund completed" : "Partial refund completed", `${rupiah(refundAmount)} has been confirmed as refunded by the payment provider. Returned products are not placed back into available stock until NIXP inspects them.`),
    idempotencyKey: `customer-refund-confirmation-${order?.id}-${Number(refundAmount || 0)}`
  });
}

export async function sendOrderRefundNotification(order, refundAmount, fullRefund = true) {
  return sendNotificationEmail({
    subject: `NIXP ${fullRefund ? "refund" : "partial refund"} verified: ${orderReference(order)}`,
    replyTo: order?.customer?.email,
    text: statusEmailText(order, fullRefund ? "Refund verified" : "Partial refund verified", `Provider-verified refund amount: ${rupiah(refundAmount)}. Inventory remains awaiting inspection.`),
    html: statusEmailHtml(order, fullRefund ? "Refund verified" : "Partial refund verified", `Provider-verified refund amount: ${rupiah(refundAmount)}. Inventory remains awaiting inspection.`),
    idempotencyKey: `internal-refund-notification-${order?.id}-${Number(refundAmount || 0)}`
  });
}

async function sendNotificationEmail({ to, subject, replyTo, text, html, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NIXP_EMAIL_FROM || process.env.REQUEST_EMAIL_FROM || DEFAULT_FROM;
  const recipient = to || process.env.NIXP_NOTIFICATION_TO || process.env.REQUEST_NOTIFICATION_TO || DEFAULT_TO;
  if (apiKey) return sendWithResend({ apiKey, from, to: recipient, replyTo, subject, text, html, idempotencyKey });
  if (process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_APP_PASSWORD) {
    return sendWithGoogleWorkspace({ from, to: recipient, replyTo, subject, text, html });
  }
  return { delivered: false, reason: "email-not-configured" };
}

async function sendWithResend({ apiKey, from, to, replyTo, subject, text, html, idempotencyKey }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify({
      from,
      to: [to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
      html
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Notification email could not be delivered.");
  return { delivered: true, id: payload.id || null, provider: "resend" };
}

async function sendWithGoogleWorkspace({ from, to, replyTo, subject, text, html }) {
  const user = process.env.GMAIL_SMTP_USER;
  const transporter = nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.GMAIL_SMTP_PORT || 465),
    secure: Number(process.env.GMAIL_SMTP_PORT || 465) === 465,
    auth: {
      user,
      pass: process.env.GMAIL_SMTP_APP_PASSWORD
    }
  });
  const result = await transporter.sendMail({
    from: from || `NIXP <${user}>`,
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html
  });
  return { delivered: true, id: result.messageId || null, provider: "google-workspace" };
}

function requestEmailText(request) {
  return [
    "New NIXP request item",
    `Artist: ${request.artistName}`,
    `Title / item: ${request.itemName}`,
    `Format: ${request.format}`,
    `Email: ${request.email}`,
    `WhatsApp: ${request.whatsapp || "Not provided"}`,
    `Notes: ${request.notes || "None"}`,
    `Request ID: ${request.id}`
  ].join("\n");
}

function requestEmailHtml(request) {
  return `<h1>New NIXP request item</h1><p><strong>Artist:</strong> ${escapeHtml(request.artistName)}<br><strong>Title / item:</strong> ${escapeHtml(request.itemName)}<br><strong>Format:</strong> ${escapeHtml(request.format)}<br><strong>Email:</strong> ${escapeHtml(request.email)}<br><strong>WhatsApp:</strong> ${escapeHtml(request.whatsapp || "Not provided")}<br><strong>Notes:</strong> ${escapeHtml(request.notes || "None")}<br><strong>Request ID:</strong> ${escapeHtml(request.id)}</p>`;
}

function orderEmailText(order, customer) {
  return [
    "New NIXP order",
    `Order ID: ${order.id}`,
    `Status: ${order.status}`,
    `Official total: ${rupiah(order.total)}`,
    "",
    "Customer",
    `Name: ${customer.name || "Not provided"}`,
    `Email: ${customer.email || "Not provided"}`,
    `WhatsApp: ${customer.whatsapp || "Not provided"}`,
    `Notes: ${customer.notes || "None"}`,
    "",
    "Items",
    ...orderItems(order).map((item) => `- ${item}`)
  ].join("\n");
}

function orderEmailHtml(order, customer) {
  return `<h1>New NIXP order</h1><p><strong>Order ID:</strong> ${escapeHtml(order.id)}<br><strong>Status:</strong> ${escapeHtml(order.status)}<br><strong>Official total:</strong> ${escapeHtml(rupiah(order.total))}</p><h2>Customer</h2><p><strong>Name:</strong> ${escapeHtml(customer.name || "Not provided")}<br><strong>Email:</strong> ${escapeHtml(customer.email || "Not provided")}<br><strong>WhatsApp:</strong> ${escapeHtml(customer.whatsapp || "Not provided")}<br><strong>Notes:</strong> ${escapeHtml(customer.notes || "None")}</p><h2>Items</h2><ul>${orderItems(order).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function customerOrderText(order, customer, delivery) {
  const address = delivery.shippingAddress || {};
  return [
    "NIXP order received",
    `Order: ${orderReference(order)}`,
    `Official total: ${rupiah(order.total ?? order.grand_total)}`,
    `Payment: ${order.paymentStatus || order.payment_status || "Pending"}`,
    `Payment expires: ${formatDate(order.paymentExpiresAt || order.payment_expires_at)}`,
    "",
    `Customer: ${customer.name}`,
    `Shipping method: ${delivery.shippingMethod || order.shipping_method || "Not selected"}`,
    ...addressLines(address),
    "",
    "Items",
    ...orderItems(order).map((item) => `- ${item}`),
    "",
    "NIXP will only mark payment as paid after secure provider verification."
  ].join("\n");
}

function customerOrderHtml(order, customer, delivery) {
  const address = delivery.shippingAddress || {};
  return `<h1>NIXP order received</h1><p><strong>Order:</strong> ${escapeHtml(orderReference(order))}<br><strong>Official total:</strong> ${escapeHtml(rupiah(order.total ?? order.grand_total))}<br><strong>Payment:</strong> ${escapeHtml(order.paymentStatus || order.payment_status || "Pending")}<br><strong>Payment expires:</strong> ${escapeHtml(formatDate(order.paymentExpiresAt || order.payment_expires_at))}</p><h2>Delivery</h2><p><strong>Customer:</strong> ${escapeHtml(customer.name)}<br><strong>Shipping method:</strong> ${escapeHtml(delivery.shippingMethod || order.shipping_method || "Not selected")}<br>${addressLines(address).map(escapeHtml).join("<br>")}</p><h2>Items</h2><ul>${orderItems(order).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p>NIXP will only mark payment as paid after secure provider verification.</p>`;
}

function statusEmailText(order, title, message) {
  return [
    `NIXP ${title}`,
    `Order: ${orderReference(order)}`,
    message,
    `Official total: ${rupiah(order?.grand_total ?? order?.total)}`,
    `Payment: ${order?.payment_status || order?.paymentStatus || "-"}`,
    `Fulfillment: ${order?.fulfillment_status || order?.fulfillmentStatus || "-"}`,
    `Shipping: ${order?.shipping_status || order?.shippingStatus || "-"}`,
    order?.courier ? `Courier: ${order.courier}` : "",
    order?.tracking_number ? `Tracking number: ${order.tracking_number}` : ""
  ].filter(Boolean).join("\n");
}

function statusEmailHtml(order, title, message) {
  return `<h1>NIXP ${escapeHtml(title)}</h1><p><strong>Order:</strong> ${escapeHtml(orderReference(order))}<br>${escapeHtml(message)}</p><p><strong>Official total:</strong> ${escapeHtml(rupiah(order?.grand_total ?? order?.total))}<br><strong>Payment:</strong> ${escapeHtml(order?.payment_status || order?.paymentStatus || "-")}<br><strong>Fulfillment:</strong> ${escapeHtml(order?.fulfillment_status || order?.fulfillmentStatus || "-")}<br><strong>Shipping:</strong> ${escapeHtml(order?.shipping_status || order?.shippingStatus || "-")}${order?.courier ? `<br><strong>Courier:</strong> ${escapeHtml(order.courier)}` : ""}${order?.tracking_number ? `<br><strong>Tracking number:</strong> ${escapeHtml(order.tracking_number)}` : ""}</p>`;
}

function addressLines(address) {
  return [
    address.recipient,
    address.phone,
    address.address1,
    address.address2,
    [address.district, address.city].filter(Boolean).join(", "),
    [address.province, address.postalCode].filter(Boolean).join(" "),
    address.country
  ].filter(Boolean);
}

function orderReference(order) {
  return order?.public_reference || order?.publicReference || order?.id || "NIXP order";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
}

function slug(value) {
  return String(value || "none").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function orderItems(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return ["No line items returned."];
  return items.map((item) => {
    const quantity = item.quantity || item.qty || 1;
    const size = item.size ? ` / Size ${item.size}` : "";
    const sku = item.sku ? `${item.sku} / ` : "";
    const title = [item.artist, item.title || item.productTitle || item.name || item.id].filter(Boolean).join(" - ");
    const price = item.lineTotal || item.total || item.price;
    return `${quantity} x ${sku}${title}${size}${price ? ` / ${rupiah(price)}` : ""}`;
  });
}

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

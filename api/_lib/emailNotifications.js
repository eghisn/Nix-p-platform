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

async function sendNotificationEmail({ subject, replyTo, text, html, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NIXP_EMAIL_FROM || process.env.REQUEST_EMAIL_FROM || DEFAULT_FROM;
  const to = process.env.NIXP_NOTIFICATION_TO || process.env.REQUEST_NOTIFICATION_TO || DEFAULT_TO;
  if (apiKey) return sendWithResend({ apiKey, from, to, replyTo, subject, text, html, idempotencyKey });
  if (process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_APP_PASSWORD) {
    return sendWithGoogleWorkspace({ from, to, replyTo, subject, text, html });
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [checkout, client, handlers, notifications, financeApp, marketing, vercel, migration] = await Promise.all([
  read("api/checkout.js"),
  read("src/main.js"),
  read("api/_lib/commerceHandlers.js"),
  read("api/_lib/emailNotifications.js"),
  read("api/finance-app.js"),
  read("marketing/marketing.js"),
  read("vercel.json"),
  read("supabase/migrations/20260901153355_harden_payment_sessions_and_order_access.sql")
]);

assert.match(migration, /claim_midtrans_payment_session/, "Payment session creation must be claimed atomically in PostgreSQL.");
assert.match(migration, /for update/, "The payment-session claim must lock its order and attempt row.");
assert.match(migration, /queue_notification_outbox/, "Webhook emails must be queueable without performing network delivery.");
assert.match(handlers, /rpc\/claim_midtrans_payment_session/, "Midtrans must use the atomic payment-session claim.");
assert.match(handlers, /payment-session-preparing/, "Concurrent payment clicks must receive a retryable state rather than create another provider request.");
assert.match(handlers, /fetchMidtransStatus\(order\.id, \{ allowMissing: true \}\)/, "A stale payment attempt must be checked against Midtrans before recovery.");
assert.match(handlers, /AbortSignal\.timeout\(10_000\)/, "Snap session creation must have a bounded timeout.");
assert.match(handlers, /AbortSignal\.timeout\(4_000\)/, "Webhook verification must have a bounded timeout.");
assert.match(handlers, /midtransWebhookEventKey/, "Webhook idempotency must include the verified payment state.");
assert.match(handlers, /payload\.transaction_status/, "Webhook keys must distinguish status transitions.");
assert.match(handlers, /payload\.refund_amount/, "Webhook keys must distinguish refund transitions.");

const webhookStart = handlers.indexOf("export async function handleMidtransWebhook");
const webhookEnd = handlers.indexOf("async function completeWebhookReceipt", webhookStart);
const webhook = handlers.slice(webhookStart, webhookEnd);
assert.doesNotMatch(webhook, /await drainNotificationOutbox/, "A webhook must not wait for email delivery before answering Midtrans.");
assert.match(webhook, /queueOnly: true/, "Webhook email work must be queued, not sent inline.");
assert.match(webhook, /scheduleNotificationOutboxDrain\(\)/, "Queued email delivery must be scheduled after the webhook response path is durable.");
assert.match(handlers, /waitUntil\(/, "Webhook background email work must use the serverless background-task API.");
assert.match(notifications, /queue_notification_outbox/, "Notification helpers must persist queued messages before background delivery.");

assert.match(checkout, /ORDER_ACCESS_COOKIE_NAME/, "Order access must use a dedicated HttpOnly cookie.");
assert.match(checkout, /exchange-access-token/, "The order page must exchange a one-time URL token for a cookie.");
assert.match(checkout, /HttpOnly/, "Order access cookies must not be readable by page JavaScript.");
assert.match(checkout, /existingOrder && !sameToken\(body\.orderAccessToken/, "Repeated checkout submissions must prove ownership of an existing order.");
assert.match(checkout, /\/order-status#order=/, "New order links must keep the secret token in the URL fragment.");
assert.match(handlers, /\/order-status#order=/, "Midtrans callbacks must keep the secret token in the URL fragment.");
assert.match(client, /location\.hash/, "The public order page must read secure link tokens from the fragment.");
assert.match(client, /history\.replaceState\(null, "", location\.pathname\)/, "The order page must clear the token from the address bar immediately after exchange.");
assert.doesNotMatch(client, /\/api\/order-status\?order=/, "The public order page must not send order tokens in a GET URL.");
assert.doesNotMatch(client, /data-order-token/, "The payment button must not retain the order token in the DOM.");

assert.doesNotMatch(handlers, /order_records\?select=\*/, "The Admin order list must not load every private order column.");
assert.match(handlers, /adminOrderListRow/, "Admin order-list rows must be explicitly shaped before returning them.");
assert.doesNotMatch(handlers, /shipping_address,customer_access_token/, "The Admin order list must not return address or access-token fields.");

assert.doesNotMatch(vercel, /Content-Security-Policy-Report-Only/, "CSP must be enforced, not report-only.");
assert.match(vercel, /"key": "Content-Security-Policy"/, "Public, Admin, and Analytics hosts must receive an enforced CSP.");
assert.doesNotMatch(vercel, /script-src[^;]*'unsafe-inline'/, "Enforced CSP must block inline JavaScript.");
assert.doesNotMatch(vercel, /style-src[^;]*'unsafe-inline'/, "Enforced CSP must block inline stylesheet and style-attribute injection.");
assert.match(vercel, /style-src-attr 'none'/, "Public, Admin, and Analytics hosts must block inline style attributes.");
assert.doesNotMatch(client, /style="/, "The public app must not generate inline style attributes.");
assert.doesNotMatch(marketing, /style="/, "The analytics app must not generate inline style attributes.");
assert.match(financeApp, /nonce=/, "Finance inline assets must receive a per-response CSP nonce.");
assert.match(financeApp, /financeCsp\(nonce\)/, "Finance must emit a matching nonce-based CSP header.");

console.log("Order security hardening contract passed.");

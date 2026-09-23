import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [checkout, client, handlers, notifications, financeApp, marketing, vercel, migration, retentionMigration] = await Promise.all([
  read("api/checkout.js"),
  read("src/main.js"),
  read("api/_lib/commerceHandlers.js"),
  read("api/_lib/emailNotifications.js"),
  read("api/finance-app.js"),
  read("marketing/marketing.js"),
  read("vercel.json"),
  read("supabase/migrations/20260901153355_harden_payment_sessions_and_order_access.sql"),
  read("supabase/migrations/20260921224000_preserve_midtrans_payment_session.sql")
]);

assert.match(migration, /claim_midtrans_payment_session/, "Payment session creation must be claimed atomically in PostgreSQL.");
assert.match(migration, /for update/, "The payment-session claim must lock its order and attempt row.");
assert.match(migration, /queue_notification_outbox/, "Webhook emails must be queueable without performing network delivery.");
assert.match(handlers, /rpc\/claim_midtrans_payment_session/, "Midtrans must use the atomic payment-session claim.");
assert.match(handlers, /payment-session-preparing/, "Concurrent payment clicks must receive a retryable state rather than create another provider request.");
assert.match(handlers, /fetchMidtransStatus\(order\.id, \{ allowMissing: true \}\)/, "A stale payment attempt must be checked against Midtrans before recovery.");
assert.match(handlers, /AbortSignal\.timeout\(10_000\)/, "Snap session creation must have a bounded timeout.");
assert.match(handlers, /AbortSignal\.timeout\(4_000\)/, "Webhook verification must have a bounded timeout.");
assert.match(handlers, /"Idempotency-Key": idempotencyKey/, "Snap session creation must send a stable Midtrans idempotency key.");
assert.match(handlers, /midtransIdempotencyKey\(order\.id\)/, "The Midtrans idempotency key must be derived from the stored order.");
assert.match(handlers, /validMidtransRedirectUrl/, "Midtrans redirect URLs must be restricted to the configured provider origin.");
assert.match(handlers, /Stored Midtrans payment URL does not match the active environment/, "Stored redirects must never cross from sandbox into production or vice versa.");
assert.match(handlers, /buildMidtransItemDetails\(order\)/, "Midtrans payloads must validate variant IDs and order totals before leaving NIXP.");
assert.match(handlers, /isMidtransDashboardNotificationTest\(body\)/, "The signed Midtrans dashboard test must be acknowledged without treating it as a customer order.");
assert.match(handlers, /payment_notif_test_\$\{merchantId\}_/, "Dashboard-test acknowledgement must be bound to the configured merchant ID.");
assert.match(handlers, /assertSuccessfulMidtransPayment/, "Verified payment amount and provider status must be checked before settlement.");
assert.match(handlers, /MIDTRANS_MERCHANT_ID/, "Webhook verification must bind transactions to the configured Midtrans merchant when available.");
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
const paymentBranchStart = handlers.indexOf('if (eventType === "paid")');
const paymentBranchEnd = handlers.indexOf('if (eventType === "reversal-review")', paymentBranchStart);
const paymentBranch = handlers.slice(paymentBranchStart, paymentBranchEnd);
assert.match(paymentBranch, /await queueVerifiedPaymentNotifications/, "Paid webhooks must persist receipt notifications before acknowledgement.");
assert.doesNotMatch(paymentBranch, /Promise\.allSettled/, "A notification queue failure must make the webhook retryable.");
assert.match(handlers, /async function queueVerifiedPaymentNotifications[\s\S]*await Promise\.all\(/, "Paid receipt notifications must be queued together and reject on a persistence failure.");

const tokenStart = handlers.indexOf("export async function handleMidtransToken");
const webhookStartIndex = handlers.indexOf("export async function handleMidtransWebhook");
const paymentSession = handlers.slice(tokenStart, webhookStartIndex);
assert.doesNotMatch(paymentSession, /drainNotificationOutbox/, "Payment session creation must not wait for email delivery.");
assert.match(paymentSession, /scheduleNotificationOutboxDrain\(\)/, "A failed payment-session creation must dispatch its durable assistance alert immediately in the background.");
assert.doesNotMatch(paymentSession, /expirePendingOrders/, "Payment session creation must not run catalogue or expiry maintenance.");
assert.match(handlers, /reconcilePendingMidtransPayments/, "Pending Midtrans payments must have a provider reconciliation path.");
assert.match(handlers, /const workerCount = Math\.min\(4, eligible\.length\)/, "Pending payment reconciliation must use bounded concurrency so a busy maintenance run remains within its function budget.");
assert.match(handlers, /getCommerceHealthSnapshot/, "Admin must expose a protected payment-health summary.");
assert.match(handlers, /rpc\/merge_midtrans_payment_attempt/, "Payment updates must merge provider status without erasing the stored redirect session.");
assert.match(retentionMigration, /payload = coalesce\(payload, '\{\}'::jsonb\) \|\| coalesce\(p_payload, '\{\}'::jsonb\)/, "Payment updates must preserve the existing token and redirect URL atomically.");
assert.match(checkout, /customerPaymentSummary/, "The protected customer order response must include resumability and safe payment instructions.");
assert.match(checkout, /hasUsableMidtransRedirect\(attempt\?\.payload\?\.redirectUrl, process\.env\.MIDTRANS_ENV\)/, "Customer payment recovery must match the active Midtrans environment.");
assert.match(checkout, /startAvailable: !resumeAvailable && !actionableInstructions/, "A failed pre-payment session must remain safely retryable without duplicating an actionable payment.");
assert.match(client, /payment\.resumeAvailable \|\| payment\.startAvailable/, "The payment CTA must only render for a stored redirect or a safe pre-payment retry.");
assert.match(client, /data-copy-payment-code/, "Bank-transfer orders must retain a customer-usable payment instruction path.");
assert.match(client, /payment-session-preparing/, "A customer must get an automatic retry while the secure payment session is still being created.");
assert.match(client, /orderPaymentSupportMarkup/, "A customer must have a direct support path when provider recovery is unavailable.");
assert.match(client, /order-status-message/, "Payment failures must render in a dedicated non-overlapping status region.");
assert.match(handlers, /sendOrderPaymentAssistanceNotification\(order, reason, \{ queueOnly: true \}\)/, "A payment-session failure must durably alert NIXP without delaying the customer response on email delivery.");
assert.match(notifications, /payment-assistance-required-\$\{order\?\.id\}/, "Payment assistance alerts must be idempotent per order.");
assert.match(notifications, /export async function sendCommerceOperationalAlert/, "Commerce failures must have a durable owner-alert path.");
assert.match(notifications, /commerce-alert-\$\{slug\(safeSource\)/, "Operational alerts must use a deterministic idempotency key.");
assert.match(notifications, /Commerce alert outbox unavailable; trying direct delivery/, "Operational alerts must fall back to direct email when their durable outbox is unavailable.");
assert.match(checkout, /recordAndAlertCommerceFailure\(\{ source: "checkout-api"/, "Unexpected checkout failures must alert the owner without changing the customer response.");
assert.match(checkout, /waitUntil\(backgroundWork\)/, "Customer-facing commerce alerts must run after the response path instead of delaying checkout.");
assert.match(checkout, /alertSource: "Customer shipping quote"/, "Unexpected shipping-quote failures must alert the owner.");
assert.match(checkout, /alertSource: "Commerce maintenance"/, "Failed commerce maintenance must alert the owner.");
assert.match(handlers, /source: "Midtrans webhook"/, "Failed Midtrans webhooks must alert the owner.");
assert.match(handlers, /source: "Midtrans reconciliation"/, "Failed provider reconciliation must alert the owner.");
assert.match(handlers, /Provider Reversal Review/, "Late provider reversals must not silently downgrade paid orders.");
assert.match(handlers, /stale-status-ignored/, "Out-of-order pending callbacks must not downgrade a financially final order.");
assert.match(handlers, /paymentReviews: reviewAttempts\.length/, "Payment health must surface provider reversals and chargebacks.");
assert.match(checkout, /if \(status >= 500\)[\s\S]*level: status === 429 \? "warning" : "info"/, "Expected checkout validation failures must remain info or warning events while unexpected server failures alert the owner.");
assert.match(handlers, /activePendingOrderIds\.has\(String\(row\.order_id\)\)/, "Payment health must only flag attempts that still belong to active pending orders.");

assert.match(checkout, /ORDER_ACCESS_COOKIE_NAME/, "Order access must use a dedicated HttpOnly cookie.");
assert.match(checkout, /exchange-access-token/, "The order page must exchange a one-time URL token for a cookie.");
assert.match(checkout, /HttpOnly/, "Order access cookies must not be readable by page JavaScript.");
assert.match(checkout, /existingOrder && !existingOrderAuthorized/, "Repeated checkout submissions must prove ownership of an existing order.");
assert.match(checkout, /hasCheckoutOrderAccess/, "A partial checkout must be recoverable only by the originating browser or secure token.");
assert.match(checkout, /CHECKOUT_ACCESS_COOKIE_NAME/, "Checkout recovery must use a dedicated HttpOnly cookie.");
assert.match(checkout, /setAccessCookie\(req, res, CHECKOUT_ACCESS_COOKIE_NAME, "\/api\/checkout", orderId, token\)/, "Checkout recovery cookies must be scoped only to checkout.");
assert.match(checkout, /\/order-status#order=/, "New order links must keep the secret token in the URL fragment.");
assert.match(handlers, /\/order-status#order=/, "Midtrans callbacks must keep the secret token in the URL fragment.");
assert.match(client, /location\.hash/, "The public order page must read secure link tokens from the fragment.");
assert.match(client, /history\.replaceState\(null, "", location\.pathname\)/, "The order page must clear the token from the address bar immediately after exchange.");
assert.doesNotMatch(client, /\/api\/order-status\?order=/, "The public order page must not send order tokens in a GET URL.");
assert.doesNotMatch(client, /data-order-token/, "The payment button must not retain the order token in the DOM.");
assert.doesNotMatch(notifications, /reserved for two hours/i, "Current customer email copy must use the one-hour reservation window.");

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

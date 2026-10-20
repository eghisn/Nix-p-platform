import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [checkout, handlers, client] = await Promise.all([
  readFile(new URL("../api/checkout.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_lib/commerceHandlers.js", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8")
]);

const refreshStart = checkout.indexOf('if (body.action === "refresh-payment-status")');
const refreshEnd = checkout.indexOf('if (body.action !== "start-payment")', refreshStart);
assert(refreshStart >= 0 && refreshEnd > refreshStart, "Customer payment refresh must be an explicit, separate action.");
const refreshAction = checkout.slice(refreshStart, refreshEnd);
const statusGet = checkout.slice(checkout.indexOf('if (req.method !== "GET") return json(res, 405', refreshEnd), checkout.indexOf('} catch (error) {\n    return json(res, Number(error?.statusCode || 500)', refreshEnd));
const paymentSummary = checkout.slice(checkout.indexOf('async function customerPaymentSummary'), checkout.indexOf('\nfunction parseBody', checkout.indexOf('async function customerPaymentSummary')));

assert.match(handlers, /export async function refreshCustomerMidtransPayment/, "A customer refresh must use a server-side provider verification path.");
assert.match(handlers, /fetchMidtransStatus\(order\.id, \{ allowMissing: true \}\)/, "The refresh must query Midtrans by the stored order ID.");
assert.match(handlers, /processVerifiedMidtransEvent\(verified\)/, "A refreshed provider result must use the same verified transition path as webhooks.");
assert.match(handlers, /order\.order_status !== "Active" \|\| order\.payment_status !== "Pending"/, "Final orders must not be reopened by a customer refresh.");
assert.match(refreshAction, /customer-payment-refresh/, "Live provider checks must be rate limited separately.");
assert.match(refreshAction, /limit: 12, windowSeconds: 900/, "Customer refreshes must remain practical while bounded.");
assert.match(refreshAction, /Your order remains active; please try again shortly/, "A transient provider failure must preserve the order and give the customer a clear retry path.");
assert.match(refreshAction, /customerOrderSummary\(latestOrder \|\| order\)/, "The response must reflect the order after a verified provider update.");
assert.match(refreshAction, /customerPaymentSummary\(orderId, latestOrder \|\| order\)/, "The response must return current safe payment instructions and use the verified order for attribution.");
assert.doesNotMatch(refreshAction, /createMidtransPaymentSession/, "Refreshing payment status must never create a new payment session.");
assert.match(client, /action: "refresh-payment-status"/, "The customer button must invoke live payment verification.");
assert.match(client, /Checking payment directly with Midtrans/, "The interface must make the live check clear while it runs.");
assert.match(client, /customerPaymentRefreshMessage/, "The interface must explain a checked or unavailable provider state.");
assert.match(statusGet, /!hasActionableMidtransInstructions\(payment\.instructions\)/, "The order page must detect missing QRIS or payment instructions.");
assert.match(statusGet, /refreshCustomerMidtransPayment\(orderId\)/, "Returning from Snap must verify provider instructions before rendering the order page.");
assert.match(statusGet, /latestOrder = await getOrderRecord\(orderId\)/, "A provider transition must update the order page from canonical order state.");
assert.match(statusGet, /catch \(error\)/, "A provider timeout must not hide the order page or its recovery actions.");
assert.match(paymentSummary, /const canPay = .*order\.payment_status === "Pending" && !expired/, "Expired reservations must not offer an old payment link.");
assert.match(paymentSummary, /instructions: canPay && actionableInstructions/, "Expired QRIS instructions must not be displayed as payable.");
assert.match(client, /This payment link has expired/, "The customer must see a clear expired-payment explanation.");

console.log("Customer live payment-status refresh contract passed.");

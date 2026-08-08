import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const [checkout, client, handlers, migration, policies, outboxRecovery, shippingFoundation, vercelConfig] = await Promise.all([
  read("api/checkout.js"),
  read("src/main.js"),
  read("api/_lib/commerceHandlers.js"),
  read("supabase/migrations/20260729113000_harden_checkout_payments_and_notifications.sql"),
  read("supabase/migrations/20260729120000_commerce_internal_table_policies.sql"),
  read("supabase/migrations/20260729121000_recover_stale_outbox_claims.sql"),
  read("supabase/migrations/20260729133000_shipping_quote_foundation.sql"),
  read("vercel.json")
]);

const requirements = [
  [!checkout.includes('rpc/submit_store_order'), "Checkout must not use the legacy submit_store_order RPC."],
  [checkout.includes('rpc/create_checkout_order'), "Checkout must create a reservation through create_checkout_order."],
  [checkout.includes("consumeCommerceRateLimit"), "Checkout must enforce a server-side rate limit."],
  [checkout.includes("isCheckoutOrigin"), "Checkout must check the browser origin."],
  [client.includes("CHECKOUT_SESSION_STORAGE_KEY"), "Checkout order identity must survive a page refresh."],
  [client.includes("payload.payment?.redirectUrl"), "Checkout must hand off to a provider redirect when available."],
  [handlers.includes("claim_webhook_receipt"), "Midtrans webhooks must be durably claimed before processing."],
  [handlers.includes("createMidtransPaymentSession"), "Payment sessions must be server-created from the stored order."],
  [migration.includes("notification_outbox"), "Transactional notifications must be stored in the outbox."],
  [migration.includes("commerce_rate_limits"), "Checkout abuse limits must be stored in the database."],
  [policies.includes("No direct access to notification outbox"), "Internal commerce tables must deny direct public access."],
  [outboxRecovery.includes("status = 'Sending'"), "Stale claimed emails must be recoverable."],
  [checkout.includes("create_shipping_quote_request"), "JNE and GoSend checkout must create a delivery quote request before payment."],
  [checkout.includes('"JNE Manual"'), "Checkout must preserve a manual JNE quote fallback when the official source is unavailable."],
  [client.includes("data-checkout-manual-jne"), "Checkout must expose the manual JNE fallback without a blocking error state."],
  [shippingFoundation.includes("issue_shipping_quote"), "Shipping quotes must reserve stock only after an operator issues the amount."],
  [shippingFoundation.includes("vinyl-cardboard-bubble"), "Format-based package profiles must be stored for public products."],
  [shippingFoundation.includes("shippingCollected"), "Finance must keep shipping collected separate from merchandise revenue."],
  [checkout.includes("sameToken"), "Customer order status must require a secure per-order token."],
  [checkout.includes("CRON_SECRET"), "Background commerce maintenance must require a scheduler secret."],
  [vercelConfig.includes("commerce-maintenance"), "A Vercel cron must invoke commerce maintenance."],
  [vercelConfig.includes('"/order-status"'), "The customer order status route must resolve to the public app."]
];

const failures = requirements.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error("Commerce contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Commerce contract passed.");

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const [checkout, client, adminStore, handlers, shippingEngine, migration, policies, outboxRecovery, shippingFoundation, stockLedger, stockWriteGuard, atomicReservation, financeState, vercelConfig] = await Promise.all([
  read("api/checkout.js"),
  read("src/main.js"),
  read("src/services/adminStore.js"),
  read("api/_lib/commerceHandlers.js"),
  read("api/_lib/nixpShippingEngine.js"),
  read("supabase/migrations/20260729103555_harden_checkout_payments_and_notifications.sql"),
  read("supabase/migrations/20260729104345_commerce_internal_table_policies.sql"),
  read("supabase/migrations/20260729104514_recover_stale_outbox_claims.sql"),
  read("supabase/migrations/20260729121848_shipping_quote_foundation.sql"),
  read("supabase/migrations/20260828163000_atomic_finance_stock_ledger.sql"),
  read("supabase/migrations/20260828163553_enforce_finance_stock_on_catalog_writes.sql"),
  read("supabase/migrations/20260831184251_atomic_checkout_reservation_and_one_hour_expiry.sql"),
  read("api/_lib/financeState.js"),
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
  [!checkout.includes('"JNE Manual"'), "Checkout must not create unpriced manual JNE orders."],
  [!client.includes("data-checkout-manual-jne"), "Checkout must rely on the activated internal tariff snapshot rather than a manual JNE fallback."],
  [!checkout.includes("JneOfficialClient"), "Customer checkout and destination search must not call JNE directly."],
  [checkout.includes('jne_destinations?select=local_region_code'), "Destination search must use the internal Supabase snapshot."],
  [shippingEngine.includes("active_shipping_rates"), "Checkout must calculate JNE prices from the activated internal rate snapshot."],
  [shippingEngine.includes("NIXP_INTERNAL_JNE_SNAPSHOT"), "Shipping quotes must identify the immutable internal tariff source."],
  [adminStore.includes("const initialStore = browserStore?.version === STORE_VERSION ? browserStore : {}"), "Admin must render from a local seed or cache before its Supabase refresh finishes."],
  [shippingEngine.includes('events.find((event) => event.event_type === "health-check")'), "The shipping dashboard must use saved health state instead of blocking every render on JNE."],
  [shippingFoundation.includes("issue_shipping_quote"), "Shipping quotes must reserve stock only after an operator issues the amount."],
  [shippingFoundation.includes("vinyl-cardboard-bubble"), "Format-based package profiles must be stored for public products."],
  [shippingFoundation.includes("shippingCollected"), "Finance must keep shipping collected separate from merchandise revenue."],
  [stockLedger.includes("reconcile_finance_stock_to_catalog"), "Commerce must reconcile catalog availability from Finance stock."],
  [stockLedger.includes("status = 'Active'"), "Stock reconciliation must subtract active reservations only."],
  [stockLedger.includes("select state into v_state from public.finance_state where key = 'main' for update"), "Payment, release, and reconciliation must lock Finance stock atomically."],
  [stockLedger.includes("'{inventoryStock}'") && stockLedger.includes("v_next_inventory_stock"), "Verified payments must debit Finance stock atomically."],
  [stockLedger.includes("order by product_id, coalesce(size_label, ''), id"), "Payment and release must lock products in a stable order."],
  [stockWriteGuard.includes("create trigger enforce_product_stock_from_finance"), "Catalog writes must not revive active-reservation stock before the server deploy completes."],
  [atomicReservation.includes("v_physical_quantity - v_reserved_before"), "Checkout must reserve Finance quantity minus active reservations."],
  [atomicReservation.includes("interval '1 hour'"), "Checkout and shipping quote reservations must use a one-hour payment window."],
  [atomicReservation.includes("release_order_reservations"), "Expired orders must use the Finance-aware reservation release transaction."],
  [handlers.includes('expiry: { unit: "hour", duration: 1 }'), "Midtrans must use the same one-hour payment expiry."],
  [handlers.includes('"Idempotency-Key": idempotencyKey'), "Midtrans session creation must be idempotent."],
  [handlers.includes("reconcilePendingMidtransPayments"), "Commerce maintenance must reconcile pending provider transactions."],
  [client.includes("data-admin-payment-reconcile-form"), "Admin Orders must surface payment reconciliation and health."],
  [client.includes('nixp:public-commerce-refreshed'), "Public pages must patch live sold-out commerce state without rerendering editorial content."],
  [financeState.includes("await reconcileFinanceStockToCatalog(skus);"), "Finance catalog sync must use the database stock reconciler."],
  [financeState.includes("const quantity = index === undefined ? catalogQuantity : normalizedQuantity(existing.qty);"), "Admin saves must preserve existing Finance stock quantities."],
  [checkout.includes("const maintenance = await expirePendingOrders();"), "Maintenance must finish stock releases before reconciliation."],
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

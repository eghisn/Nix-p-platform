import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [adminApp, adminStore, commerceHandlers, financeApp, migration] = await Promise.all([
  readFile("src/main.js", "utf8"),
  readFile("src/services/adminStore.js", "utf8"),
  readFile("api/_lib/commerceHandlers.js", "utf8"),
  readFile("apps/finance/index.html", "utf8"),
  readFile("supabase/migrations/20260920101500_separate_test_and_customer_orders.sql", "utf8")
]);

assert.match(adminApp, /Customer website revenue/);
assert.match(adminApp, /Test orders excluded/);
assert.match(adminApp, /paidCustomerOrders/);
assert.match(adminApp, /order\.orderClass/);
assert.match(adminStore, /orderClass: row\.order_class/);
assert.match(commerceHandlers, /metadata,order_class,order_status/);

assert.match(financeApp, /Sales channel/);
assert.match(financeApp, /Record class/);
assert.match(financeApp, /function isRecognizedCustomerSale/);
assert.match(financeApp, /isRecognizedCustomerSale\(item\)/);
assert.match(financeApp, /Test record \/ excluded from reporting/);
assert.match(financeApp, /Customer total/);
assert.doesNotMatch(financeApp, /const salesYear = state\.sales\.filter\(item => yearOf\(item\.date\) === year\);/);

assert.match(migration, /order_records_order_class_check/);
assert.match(migration, /classify_checkout_order_record/);
assert.match(migration, /sku ~\* '\^NXP-TEST-'/);
assert.match(migration, /normalize_finance_sales_payload/);
assert.match(migration, /'orderClass', case/);
assert.match(migration, /coalesce\(order_record\.order_class, 'Customer'\) <> 'Test'/);
assert.match(migration, /refresh_marketing_rollups/);

console.log("Customer and test order separation contract passed.");

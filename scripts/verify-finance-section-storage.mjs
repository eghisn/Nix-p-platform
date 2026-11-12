import assert from "node:assert/strict";
import { changedFinanceSections, financeCatalogSyncRequest, removedWebsiteSaleOrderIds, writeFinanceState } from "../api/_lib/financeState.js";
import { readFile } from "node:fs/promises";

const base = {
  general: [], sales: [], expenses: [], inventory: [], inventoryStock: [], monthlyReports: [], openingCash: null, targets: {}
};

assert.deepEqual(changedFinanceSections(base, { ...base, expenses: [{ id: "expense-1", amount: 1 }] }), {
  expenses: [{ id: "expense-1", amount: 1 }]
});
const paidSale = { id: "sale-order-c950e51f-035a-4790-bc9d-ba767f0c9149", invoice: "order-c950e51f-035a-4790-bc9d-ba767f0c9149", revenue: 350000 };
assert.deepEqual(removedWebsiteSaleOrderIds([paidSale], []), [paidSale.invoice]);
assert.deepEqual(removedWebsiteSaleOrderIds([paidSale], [{ ...paidSale, revenue: 340000 }]), []);
assert.deepEqual(removedWebsiteSaleOrderIds([paidSale], null), []);
assert.deepEqual(changedFinanceSections(base, { ...base, expenses: [{ id: "expense-1" }], inventoryStock: [{ sku: "NXP-1" }] }, ["expenses"]), {
  expenses: [{ id: "expense-1" }]
});

const previousInventory = {
  ...base,
  expenses: [{ id: "expense-1", amount: 1 }],
  inventory: [{ id: "purchase-a", sku: "NXP-A", unitCost: 100 }],
  inventoryStock: [{ id: "stock-a", sku: "NXP-A", qty: 1 }]
};
const nextInventory = {
  ...previousInventory,
  expenses: [{ id: "expense-1", amount: 2 }],
  inventory: [{ id: "purchase-a", sku: "NXP-A", unitCost: 125 }],
  inventoryStock: [{ id: "stock-a", sku: "NXP-A", qty: 1 }]
};
assert.equal(financeCatalogSyncRequest(previousInventory, nextInventory, { expenses: nextInventory.expenses }), null);
assert.deepEqual(
  financeCatalogSyncRequest(previousInventory, nextInventory, { inventory: nextInventory.inventory }),
  {
    targetSkus: ["NXP-A"],
    targetInventoryIds: ["purchase-a"],
    changedSections: ["inventory"],
    fullInventorySync: false
  }
);
const changedSku = {
  ...nextInventory,
  inventoryStock: [{ id: "stock-a", sku: "NXP-B", qty: 1 }]
};
assert.deepEqual(
  financeCatalogSyncRequest(nextInventory, changedSku, { inventoryStock: changedSku.inventoryStock }),
  {
    targetSkus: ["NXP-A", "NXP-B"],
    targetInventoryIds: [],
    changedSections: ["inventoryStock"],
    fullInventorySync: false
  }
);
const deletedStock = { ...nextInventory, inventoryStock: [] };
assert.deepEqual(
  financeCatalogSyncRequest(nextInventory, deletedStock, { inventoryStock: deletedStock.inventoryStock }),
  {
    targetSkus: ["NXP-A"],
    targetInventoryIds: [],
    changedSections: ["inventoryStock"],
    fullInventorySync: false
  }
);
const nonCatalogStock = { ...base, inventoryStock: [{ id: "note-a", qty: 1 }] };
assert.equal(
  financeCatalogSyncRequest(base, nonCatalogStock, { inventoryStock: nonCatalogStock.inventoryStock }),
  null
);

const financeUi = await readFile("apps/finance/index.html", "utf8");
assert.doesNotMatch(financeUi, /removeLegacy350kEntries|isLegacy350kDailySale|isLegacy350kGeneralIncome/);
assert.match(financeUi, /changedSections: changedFinanceSections\(\)/);
assert.match(financeUi, /setFormValue\(el\.stockForm, "qty", item\.qty \?\? 1\);/);
assert.doesNotMatch(financeUi, /setFormValue\(el\.stockForm, "qty", item\.qty \|\| 1\);/);
assert.doesNotMatch(financeUi, /Saving your latest edits/);
assert.doesNotMatch(financeUi, /Catalog research queued/);
assert.match(financeUi, /data-reconcile-closed-month/);
assert.match(financeUi, /reconcileClosedMonthlyReport/);

const stateApi = await readFile("api/state.js", "utf8");
assert.match(stateApi, /changedSections: body\.changedSections \|\| null/);

const financeState = await readFile("api/_lib/financeState.js", "utf8");
assert.match(financeState, /processFinanceCatalogSyncJobs/);
assert.match(financeState, /syncSkus/);
assert.match(financeState, /Catalog inventory synchronized/);

const migration = await readFile("supabase/migrations/20260830121400_finance_catalog_sync_jobs.sql", "utf8");
assert.match(migration, /finance_catalog_sync_jobs/);
assert.match(migration, /enable row level security/);
assert.match(migration, /service_role/);

const costCorrectionMigration = await readFile("supabase/migrations/20260928130000_reconcile_paid_sale_cogs_on_stock_cost_edit.sql", "utf8");
assert.match(costCorrectionMigration, /v_changed_cost_skus/);
assert.match(costCorrectionMigration, /public\.order_lines/);
assert.match(costCorrectionMigration, /v_effective_changes := jsonb_set\(v_effective_changes, '\{sales\}'/);
assert.match(costCorrectionMigration, /quantity-only edit never enters this path/);

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let attemptedWrite = false;
try {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("finance_state_sections?")) {
      return Response.json(Object.entries({ ...base, sales: [paidSale] })
        .map(([section, payload]) => ({ section, payload, revision: 1, updated_at: "2026-11-11T08:07:22Z" })));
    }
    if (path.includes("order_records?")) {
      return Response.json([{ id: paidSale.invoice, payment_status: "Paid" }]);
    }
    attemptedWrite = true;
    throw new Error(`Unexpected finance write: ${path}`);
  };
  await assert.rejects(
    writeFinanceState({ ...base, sales: [] }, { changedSections: ["sales"], expectedSectionVersions: { sales: 1 }, syncCatalog: false }),
    (error) => error.statusCode === 409 && /paid website sale/i.test(error.message)
  );
  assert.equal(attemptedWrite, false);
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log("Finance section storage contract passed.");

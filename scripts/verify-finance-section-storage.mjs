import assert from "node:assert/strict";
import { changedFinanceSections, financeCatalogSyncRequest } from "../api/_lib/financeState.js";
import { readFile } from "node:fs/promises";

const base = {
  general: [], sales: [], expenses: [], inventory: [], inventoryStock: [], monthlyReports: [], openingCash: null, targets: {}
};

assert.deepEqual(changedFinanceSections(base, { ...base, expenses: [{ id: "expense-1", amount: 1 }] }), {
  expenses: [{ id: "expense-1", amount: 1 }]
});
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
assert.match(financeUi, /changedSections: changedFinanceSections\(\)/);
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

const migration = await readFile("supabase/migrations/20260830123000_finance_catalog_sync_jobs.sql", "utf8");
assert.match(migration, /finance_catalog_sync_jobs/);
assert.match(migration, /enable row level security/);
assert.match(migration, /service_role/);

console.log("Finance section storage contract passed.");

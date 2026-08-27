import assert from "node:assert/strict";
import { changedFinanceSections } from "../api/_lib/financeState.js";
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

const financeUi = await readFile("apps/finance/index.html", "utf8");
assert.match(financeUi, /changedSections: changedFinanceSections\(\)/);
assert.doesNotMatch(financeUi, /Saving your latest edits/);

const stateApi = await readFile("api/state.js", "utf8");
assert.match(stateApi, /changedSections: body\.changedSections \|\| null/);

console.log("Finance section storage contract passed.");

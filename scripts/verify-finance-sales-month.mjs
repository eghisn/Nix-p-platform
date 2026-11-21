import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("apps/finance/index.html", "utf8");
const start = html.indexOf("    function salesMonth(item) {");
const end = html.indexOf("    function renderSales() {", start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(`${html.slice(start, end)}\nthis.salesMonth = salesMonth;`, context);
const month = context.salesMonth;
assert.equal(month({ invoice: "NXP-WA20261108-006", date: "2026-11-08" }), "2026-11");
assert.equal(month({ invoice: "NXP-WA-20261006-002", date: "2026-11-01" }), "2026-10");
assert.equal(month({ invoice: "NXP-STORE-20251231-001", date: "2026-01-01" }), "2025-12");
assert.equal(month({ invoice: "order-c950e51f-035a-4790-bc9d-ba767f0c9149", date: "2026-11-11" }), "2026-11");
assert.equal(month({ invoice: "NXP-WA20260230-001", date: "2026-02-28" }), "unknown");
assert.equal(month({ invoice: "OTHER", date: "2024-02-29" }), "2024-02");
assert.equal(month({ invoice: "OTHER", date: "" }), "unknown");
assert.match(html, /state\.sales\.filter\(item => !el\.salesMonthFilter\.value \|\| salesMonth\(item\) === el\.salesMonthFilter\.value\)/);
assert.match(html, /const totals = rows\.filter\(item => !isTestSale\(item\)\)/);
const renderEnd = html.indexOf("    function renderExpenses() {", end);
const select = { value: "2026-10", innerHTML: "" };
const count = { textContent: "" };
const elements = { salesMonthFilter: select, salesSearch: { value: "" }, salesBody: { innerHTML: "" }, salesTotals: { innerHTML: "" } };
Object.assign(context, {
  el: elements,
  state: { sales: [
    { invoice: "NXP-WA20261006-002", date: "2026-10-06", qty: 1, revenue: 100, cogs: 40, grossProfit: 60 },
    { invoice: "order-id", date: "2026-11-01", qty: 1, revenue: 200, cogs: 100, grossProfit: 100 },
    { invoice: "NXP-WA20261020-003", date: "2026-10-20", qty: 1, revenue: 10, cogs: 0, grossProfit: 10, orderClass: "Test" }
  ] },
  document: { getElementById: () => count },
  searchQuery: input => input.value.toLowerCase(),
  sortRows: (_section, rows) => rows,
  filterRows: (rows, query, fields) => rows.filter(item => !query || fields(item).join(" ").toLowerCase().includes(query)),
  isTestSale: item => item.orderClass === "Test",
  saleRecordedSize: () => "", saleChannel: () => "", saleOrderClass: item => item.orderClass || "Customer",
  escapeHTML: value => String(value ?? ""), rupiah: value => String(value), formatPercent: value => String(value || 0),
  editButton: () => "", deleteButton: () => "", emptyRow: () => "empty", numeric: value => Number(value || 0)
});
vm.runInContext(`${html.slice(end, renderEnd)}\nthis.renderSales = renderSales;`, context);
context.renderSales();
assert.equal(count.textContent, "1 customer, 1 test");
assert.match(elements.salesBody.innerHTML, /NXP-WA20261006-002/);
assert.doesNotMatch(elements.salesBody.innerHTML, /order-id/);
assert.match(elements.salesTotals.innerHTML, /<td class="money">100<\/td>/);
elements.salesSearch.value = "20261020";
context.renderSales();
assert.equal(count.textContent, "0 customers, 1 test");
assert.doesNotMatch(elements.salesBody.innerHTML, /NXP-WA20261006-002/);
assert.match(elements.salesTotals.innerHTML, /<td class="money">0<\/td>/);
console.log("Finance sales invoice month filter passed.");

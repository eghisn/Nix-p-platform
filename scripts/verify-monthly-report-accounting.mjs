import fs from "node:fs";

const source = fs.readFileSync("apps/finance/index.html", "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} in finance report source`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const reportSource = [
  extractFunction("reportTarget"),
  extractFunction("inventoryValueAtCost"),
  extractFunction("reportCalculation")
].join("\n");

const numeric = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const rupiah = value => `Rp ${numeric(value)}`;
const formatMonthLabel = month => month;
const isRecognizedSale = item => item.recognized !== false;
const saleHasMissingCogs = item => isRecognizedSale(item) && numeric(item.revenue) > 0 && numeric(item.qty) > 0 && numeric(item.cogs) <= 0;

function getReport(state, rows, month = "2026-08") {
  const buildDashboardRows = () => rows;
  const factory = new Function(
    "state",
    "currentMonth",
    "ownerReimbursementCategory",
    "ownerDueCategory",
    "buildDashboardRows",
    "isRecognizedSale",
    "saleHasMissingCogs",
    "monthOf",
    "numeric",
    "rupiah",
    "formatMonthLabel",
    "operatingExpenseStartMonth",
    `${reportSource}; return reportCalculation;`
  );
  return factory(
    state,
    month,
    "Owner Reimbursement",
    "Owner Due",
    buildDashboardRows,
    isRecognizedSale,
    saleHasMissingCogs,
    date => String(date || "").slice(0, 7),
    numeric,
    rupiah,
    formatMonthLabel,
    "2026-11"
  )(month);
}

const augustState = {
  sales: [],
  inventoryStock: [],
  openingCash: null,
  targets: {}
};
const augustRows = [
  { date: "2026-08-04", type: "Outcome", category: "Inventory", amount: 490875, recognized: true },
  { date: "2026-08-05", type: "Outcome", category: "Operations", amount: 115000, recognized: true },
  { date: "2026-08-06", type: "Outcome", category: "Sales COGS", amount: 12723191, id: "orphan-sale", recognized: true }
];
const august = getReport(augustState, augustRows);
const augustExpected = {
  cashOut: 605875,
  netCashMovement: -605875,
  salesRevenue: 0,
  cogs: 0,
  grossProfit: 0,
  totalOperatingExpenses: 0,
  operatingProfit: 0,
  netIncome: 0
};
for (const [key, expected] of Object.entries(augustExpected)) {
  if (august[key] !== expected) throw new Error(`August regression failed for ${key}: got ${august[key]}, expected ${expected}`);
}
if (august.orphanedCogsAmount !== 12723191) {
  throw new Error(`August orphaned COGS audit failed: got ${august.orphanedCogsAmount}`);
}

const saleState = {
  sales: [{ id: "sale-1", date: "2026-08-08", qty: 2, revenue: 200000, cogs: 100000, paymentStatus: "Paid" }],
  inventoryStock: [],
  openingCash: null,
  targets: {}
};
const saleRows = [
  { date: "2026-08-08", type: "Income", category: "Sales", amount: 200000, id: "sale-1", recognized: true },
  { date: "2026-08-08", type: "Outcome", category: "Sales COGS", amount: 100000, id: "sale-1", recognized: true }
];
const sale = getReport(saleState, saleRows);
if (sale.cogs !== 100000 || sale.grossProfit !== 100000 || sale.unitsSold !== 2) {
  throw new Error(`Recognized-sale regression failed: ${JSON.stringify({ cogs: sale.cogs, grossProfit: sale.grossProfit, unitsSold: sale.unitsSold })}`);
}

const november = getReport(
  { sales: [], inventoryStock: [], openingCash: null, targets: {} },
  [{ date: "2026-11-05", type: "Outcome", category: "Operations", amount: 115000, recognized: true }],
  "2026-11"
);
if (november.totalOperatingExpenses !== 115000 || november.operatingProfit !== -115000 || november.netIncome !== -115000) {
  throw new Error(`November OPEX regression failed: ${JSON.stringify({ totalOperatingExpenses: november.totalOperatingExpenses, operatingProfit: november.operatingProfit, netIncome: november.netIncome })}`);
}

console.log("Monthly investor report accounting regression passed.");

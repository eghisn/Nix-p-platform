import assert from "node:assert/strict";
import { currentInventoryRows } from "../src/services/catalogService.js";

const mirroredInventory = [
  { id: "purchase-a", sku: "SKU-A", qty: 2, origin: "finance-purchase" },
  { id: "purchase-b", sku: "SKU-B", qty: 1, origin: "finance-purchase" },
  { id: "stock-a", sku: "SKU-A", qty: 1, origin: "finance-stock" },
  { id: "stock-b", sku: "SKU-B", qty: 0, origin: "finance-stock" }
];

assert.deepEqual(
  currentInventoryRows(mirroredInventory).map((item) => item.id),
  ["stock-a", "stock-b"],
  "Admin inventory metrics must use current stock rows without purchase-history duplication."
);

const legacyInventory = [
  { id: "legacy-a", sku: "SKU-A", stock: 1 },
  { id: "legacy-purchase", sku: "SKU-B", qty: 1, origin: "finance-purchase" }
];

assert.deepEqual(
  currentInventoryRows(legacyInventory).map((item) => item.id),
  ["legacy-a"],
  "Legacy inventory remains readable while explicit purchase mirrors stay excluded."
);

console.log("Admin inventory metrics use current stock rows only.");

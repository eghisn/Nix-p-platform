import assert from "node:assert/strict";
import { renderOrderNotification } from "../api/_lib/emailNotifications.js";

const customer = { name: "Customer", email: "customer@example.com" };
const databaseOrder = {
  id: "order-test",
  order_status: "Active",
  payment_status: "Pending",
  grand_total: 367000,
  items: [{ sku: "NXP-2026-APP-0007", artist: "Cold Metal Breathes Too", title: "T-shirt", quantity: 1 }]
};
const databaseEmail = renderOrderNotification(databaseOrder, customer);
assert.match(databaseEmail.subject, /Rp\s*367\.000$/);
assert.match(databaseEmail.text, /Status: Active/);
assert.match(databaseEmail.text, /Official total: Rp\s*367\.000/);
assert.match(databaseEmail.html, /<strong>Status:<\/strong> Active/);
assert.match(databaseEmail.html, /<strong>Official total:<\/strong> Rp\s*367\.000/);
assert.doesNotMatch(databaseEmail.subject + databaseEmail.text + databaseEmail.html, /undefined|Rp\s*0\b/);

const checkoutEmail = renderOrderNotification({ id: "order-checkout", status: "Active", total: 367000 }, customer);
assert.match(checkoutEmail.subject, /Rp\s*367\.000$/);
assert.match(checkoutEmail.text, /Status: Active/);

const missingTotal = renderOrderNotification({ id: "order-incomplete", status: "Pending" }, customer);
assert.match(missingTotal.subject, /Total unavailable$/);
assert.match(missingTotal.text, /Official total: Total unavailable/);
assert.doesNotMatch(missingTotal.subject + missingTotal.text + missingTotal.html, /Rp\s*0\b|undefined/);

console.log("Internal order notifications use canonical totals and status for database and checkout orders.");

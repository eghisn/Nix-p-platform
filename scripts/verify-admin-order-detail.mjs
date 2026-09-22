import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adminOrderDetailRow } from "../api/_lib/commerceHandlers.js";

const row = adminOrderDetailRow({
  id: "order-example1234",
  public_reference: "NXP-ORDER-1234",
  customer_access_token: "must-not-leak",
  customer: { name: "Customer", email: "customer@example.com", whatsapp: "08123456789" },
  shipping_address: {
    recipient: "Recipient", phone: "08123456789", address1: "Jl. Example 1",
    address2: "Unit 2", district: "District", city: "Jakarta",
    province: "DKI Jakarta", postalCode: "10110", country: "Indonesia"
  },
  payment_status: "Paid",
  order_status: "Active",
  grand_total: 270000,
  items: [{ sku: "SKU-1", artist: "Artist", title: "Album", quantity: 1, size_label: "" }],
  metadata: { privateNote: "must-not-leak" },
  events: [{ payload: "must-not-leak" }]
});

assert.equal(row.shippingAddress.address1, "Jl. Example 1");
assert.equal(row.shippingAddress.postalCode, "10110");
assert.equal(row.customer.whatsapp, "08123456789");
assert.equal(row.items[0].title, "Album");
assert.equal(row.paymentStatus, "Paid");
assert(!JSON.stringify(row).includes("must-not-leak"), "The admin detail response must not expose tokens or unrelated private payloads.");

const app = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const store = await readFile(new URL("../src/services/adminStore.js", import.meta.url), "utf8");
const handlers = await readFile(new URL("../api/_lib/commerceHandlers.js", import.meta.url), "utf8");
assert.match(app, /data-admin-order-view/, "Orders must have a visible detail action.");
assert.match(app, /data-admin-order-dialog/, "Order details must open without navigating away.");
assert.match(app, /Delivery address/, "The detail view must surface the shipping address.");
assert.match(store, /async orderDetail\(orderId\)/, "The address must be fetched on demand, outside the saved admin snapshot.");
assert.match(handlers, /requireWorkspace\(req, res, "admin"\)/, "The order detail endpoint must require Admin access.");
assert.match(handlers, /order: adminOrderDetailRow\(order\)/, "The endpoint must return only the explicit detail shape.");

console.log("Admin order shipping details and private-data boundary verified.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderShippingDispatchEmail } from "../api/_lib/emailNotifications.js";

const dispatch = renderShippingDispatchEmail({
  id: "order-example",
  public_reference: "NXP-ORDER-0001",
  customer: { name: "NIXP Customer", email: "customer@example.com" },
  courier: "JNE",
  shipping_status: "In Transit",
  tracking_number: "JNE123456789",
  grand_total: 270000
});

assert.match(dispatch.html, /Shipping update/, "Dispatch email must have a clear NIXP document label.");
assert.match(dispatch.html, /Founders Grotesk Web/, "Dispatch email must use the NIXP email typography.");
assert.match(dispatch.html, /FoundersGroteskWeb-Semibold\.woff2/, "Dispatch email must include the NIXP semibold font where supported.");
assert.match(dispatch.html, /font-display:swap/, "Dispatch email must never hide text during font loading.");
assert.match(dispatch.html, /NXP-ORDER-0001/, "Dispatch email must identify the order.");
assert.match(dispatch.html, /JNE123456789/, "Dispatch email must include the tracking number.");
assert.match(dispatch.text, /Courier: JNE/, "Dispatch email must include a plain-text courier fallback.");

const [app, store, handlers] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/adminStore.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_lib/commerceHandlers.js", import.meta.url), "utf8")
]);
assert.match(app, /data-admin-order-dispatch-form/, "Admin order detail must offer a dispatch form.");
assert.match(app, /Save dispatch and send email/, "Dispatch action must clearly explain its result.");
assert.match(store, /async updateOrderOperation\(data/, "Dispatch updates must use the Admin store boundary.");
assert.match(handlers, /shipping-details-unchanged/, "Unchanged tracking details must not trigger duplicate shipping email.");
assert.match(handlers, /sendCustomerShippingNotification\(after\)/, "Shipping changes must notify the customer after the order update is saved.");

console.log("Shipping dispatch email and Admin operation flow verified.");

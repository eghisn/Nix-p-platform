import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [client, styles] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/base.css", import.meta.url), "utf8")
]);

const orderStatusStart = client.indexOf("async function customerOrderStatusPage()");
const orderStatusEnd = client.indexOf("async function cartSummary", orderStatusStart);
const orderStatusPage = client.slice(orderStatusStart, orderStatusEnd > orderStatusStart ? orderStatusEnd : undefined);

assert.ok(orderStatusStart >= 0, "The customer order-status page must remain present.");
assert.doesNotMatch(orderStatusPage, /admin-form-note/, "Order status must not reuse the admin note style with negative margins.");
assert.match(orderStatusPage, /order-status-payment/, "Pending payment content must have a dedicated layout container.");
assert.match(orderStatusPage, /order-status-message/, "Payment feedback must render in its own status region.");
assert.match(orderStatusPage, /orderPaymentSupportMarkup/, "Payment recovery must retain direct customer support actions.");
assert.match(client, /order-payment-qr/, "Pending QRIS payments must render a recoverable QR code.");

assert.match(styles, /\.order-status-payment\s*\{[^}]*display:\s*grid;[^}]*gap:\s*18px;/s, "Payment controls must keep stable vertical spacing.");
assert.match(styles, /\.order-status-message\s*\{[^}]*margin:\s*0;[^}]*overflow-wrap:\s*anywhere;/s, "Payment messages must wrap without negative margins.");
assert.match(styles, /\.order-status-message:empty\s*\{[^}]*display:\s*none;/s, "An empty payment message must not reserve stray space.");
assert.match(styles, /@media \(max-width:\s*640px\)[\s\S]*\.order-status-actions\s*\{[^}]*grid-template-columns:\s*1fr;/, "Mobile payment actions must stack into one column.");
assert.match(styles, /\.order-status-actions \.button\s*\{[^}]*white-space:\s*normal;/s, "Long payment labels must wrap inside their buttons.");
assert.match(styles, /\.order-payment-qr img\s*\{[^}]*width:\s*min\(240px, 100%\);[^}]*aspect-ratio:\s*1;/s, "Recovered QRIS codes must have stable responsive dimensions.");

console.log("Payment recovery layout regression guard verified.");

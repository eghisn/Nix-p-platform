import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { drainNotificationOutbox, renderShippingDispatchEmail, sendCustomerShippingNotification, sendCustomerShippingQuoteRequest } from "../api/_lib/emailNotifications.js";

const order = {
  id: "order-example",
  public_reference: "NXP-ORDER-0001",
  customer: { name: "NIXP Customer", email: "customer@example.com" },
  courier: "JNE",
  shipping_status: "In Transit",
  tracking_number: "JNE123456789",
  grand_total: 270000
};
const dispatch = renderShippingDispatchEmail(order);

assert.match(dispatch.html, /Shipping update/, "Dispatch email must have a clear NIXP document label.");
assert.match(dispatch.html, /Founders Grotesk Web/, "Dispatch email must use the NIXP email typography.");
assert.match(dispatch.html, /FoundersGroteskWeb-Semibold\.woff2/, "Dispatch email must include the NIXP semibold font where supported.");
assert.match(dispatch.html, /font-display:swap/, "Dispatch email must never hide text during font loading.");
assert.match(dispatch.html, /NXP-ORDER-0001/, "Dispatch email must identify the order.");
assert.match(dispatch.html, /JNE123456789/, "Dispatch email must include the tracking number.");
assert.match(dispatch.text, /Courier: JNE/, "Dispatch email must include a plain-text courier fallback.");

const savedFetch = globalThis.fetch;
const savedEnv = Object.fromEntries(["RESEND_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NIXP_EMAIL_FROM"].map((key) => [key, process.env[key]]));
const sent = [];
try {
  process.env.RESEND_API_KEY = "test-only-key";
  process.env.NIXP_EMAIL_FROM = "NIXP <contact@nix-p.com>";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: `test-${sent.length}` }) };
  };
  await sendCustomerShippingNotification(order);
  await sendCustomerShippingQuoteRequest(order, order.customer);
  assert.equal(sent[0].from, "NIXP Shipping <shipping@nix-p.com>", "Dispatch must use the shipping sender.");
  assert.equal(sent[0].reply_to, "contact@nix-p.com", "Replies must reach the existing contact inbox.");
  assert.equal(sent[1].from, "NIXP <contact@nix-p.com>", "Quote emails must retain the normal sender.");

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  globalThis.fetch = async (url, options) => {
    if (url.includes("claim_due_notification_outbox")) {
      return { ok: true, text: async () => JSON.stringify([
        { recipient: order.customer.email, reply_to: "contact@nix-p.com", subject: "Shipping update", text_body: "Update", html_body: "<p>Update</p>", idempotency_key: "customer-shipping-order-example-in-transit-jne123456789" },
        { recipient: order.customer.email, reply_to: "contact@nix-p.com", subject: "Quote ready", text_body: "Quote", html_body: "<p>Quote</p>", idempotency_key: "customer-shipping-quote-issued-order-example" }
      ]) };
    }
    if (url.includes("complete_notification_outbox")) return { ok: true, text: async () => "{}" };
    assert.equal(url, "https://api.resend.com/emails");
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: `test-${sent.length}` }) };
  };
  const drained = await drainNotificationOutbox(2);
  assert.equal(drained.delivered, 2, "Both queued messages must be delivered in the mocked retry path.");
  assert.equal(sent[2].from, "NIXP Shipping <shipping@nix-p.com>", "Retried dispatch must keep the shipping sender.");
  assert.equal(sent[3].from, "NIXP <contact@nix-p.com>", "Retried quote must keep the normal sender.");
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const [app, store, handlers] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/adminStore.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_lib/commerceHandlers.js", import.meta.url), "utf8")
]);
assert.match(app, /data-admin-order-dispatch-form/, "Admin order detail must offer a dispatch form.");
assert.match(app, /Save dispatch and send email/, "Dispatch action must clearly explain its result.");
assert.match(app, /data-admin-shipping-preview-form/, "Admin Orders must offer a non-destructive shipping email preview.");
assert.match(store, /async updateOrderOperation\(data/, "Dispatch updates must use the Admin store boundary.");
assert.match(handlers, /shipping-details-unchanged/, "Unchanged tracking details must not trigger duplicate shipping email.");
assert.match(handlers, /sendCustomerShippingNotification\(after\)/, "Shipping changes must notify the customer after the order update is saved.");
assert.match(handlers, /send-shipping-preview/, "Shipping previews must use a dedicated Admin-only action.");
assert.match(handlers, /admin-shipping-preview/, "Shipping previews must be rate limited.");

console.log("Shipping dispatch email and Admin operation flow verified.");

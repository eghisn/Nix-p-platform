import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderDeliveryQuote } from "../api/_lib/deliveryQuote.js";

const cover = "/public/assets/catalog-archive/nxp-2026-vnl-0081-arca-kick-iiii-bandcamp.jpg";
const paymentUrl = "https://www.nix-p.com/order-status#order=order-example&token=customer-access-token";
const quote = renderDeliveryQuote({
  id: "order-example",
  public_reference: "NXP-ORDER-0001",
  customer: { name: "NIXP Customer", email: "customer@example.com" },
  merchandise_total: 350000,
  shipping_total: 25000,
  grand_total: 375000,
  shipping_method: "JNE REG",
  courier: "JNE",
  payment_expires_at: "2026-09-09T11:00:00Z",
  items: [{ product_id: "item-1", sku: "NXP-2026-VNL-0081", artist: "Arca", title: "KiCk iiii", quantity: 1, line_total: 350000 }]
}, { statusUrl: paymentUrl, catalogImages: new Map([["item-1", cover]]) });

assert.match(quote.html, /Delivery quote/, "Quote must have a clear document hierarchy.");
assert.match(quote.html, /Founders Grotesk Web/, "Quote must prefer the NIXP Founders typeface when supported.");
assert.match(quote.html, /FoundersGroteskWeb-Semibold\.woff2/, "Quote must load NIXP's semibold font where email clients permit webfonts.");
assert.match(quote.html, /font-display:swap/, "Quote font loading must never hide text while the webfont loads.");
assert.match(quote.html, /Arca/, "Quote must preserve the immutable order artist.");
assert.match(quote.html, /KiCk iiii/, "Quote must preserve the immutable order title.");
assert.match(quote.html, new RegExp(`https://www\\.nix-p\\.com${cover.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "Quote must use a managed NIXP product image.");
assert.match(quote.html, /Rp\s?375\.000/, "Quote must display the quoted total.");
assert.match(quote.html, /Review quote and pay securely/, "Quote must include a clear payment CTA.");
assert.match(quote.html, /customer-access-token/, "Quote CTA must keep the customer order access token.");
assert.match(quote.text, /Total at payment/, "Quote must include a plain-text fallback.");
assert.match(quote.text, /not a payment receipt/i, "Quote must not be presented as a completed payment.");

const notifications = await readFile(new URL("../api/_lib/emailNotifications.js", import.meta.url), "utf8");
assert.match(notifications, /renderDeliveryQuote\(order, \{ statusUrl, catalogImages: receiptCatalogImages\(order\) \}\)/, "Customer shipping quotes must use the branded quote template with managed product images.");

console.log("Delivery quote email contract passed.");

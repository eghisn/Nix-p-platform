import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderPaymentReceipt } from "../api/_lib/paymentReceipt.js";

const cover = "/public/assets/catalog-archive/nxp-2026-vnl-0081-arca-kick-iiii-bandcamp.jpg";
const receipt = renderPaymentReceipt({
  id: "order-example",
  public_reference: "NXP-ORDER-0001",
  customer: { name: "NIXP Customer", email: "customer@example.com" },
  merchandise_total: 350000,
  shipping_total: 25000,
  discount_total: 10000,
  grand_total: 365000,
  shipping_method: "JNE",
  courier: "JNE",
  shipping_address: { recipient: "NIXP Customer", address1: "Jl. Example 1", city: "Jakarta", province: "DKI Jakarta", postalCode: "10110", country: "Indonesia" },
  items: [{ product_id: "item-1", sku: "NXP-2026-VNL-0081", artist: "Arca", title: "KiCk iiii", quantity: 1, unit_price: 350000, line_total: 350000 }]
}, {
  payment: { method: "Midtrans", transaction_id: "midtrans-verified-001", transaction_time: "2026-09-09T10:00:00Z" },
  catalogImages: new Map([["item-1", cover]])
});

assert.match(receipt.html, /Payment receipt/, "Receipt must have a clear document hierarchy.");
assert.match(receipt.html, /Founders Grotesk Web/, "Receipt must prefer the NIXP Founders typeface when supported.");
assert.match(receipt.html, /FoundersGroteskWeb-Semibold\.woff2/, "Receipt must load NIXP's semibold font where email clients permit webfonts.");
assert.match(receipt.html, /font-display:swap/, "Receipt font loading must never hide text while the webfont loads.");
assert.match(receipt.html, /Arca/, "Receipt must preserve the immutable order artist.");
assert.match(receipt.html, /KiCk iiii/, "Receipt must preserve the immutable order title.");
assert.match(receipt.html, new RegExp(`https://www\\.nix-p\\.com${cover.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "Receipt must use a managed NIXP product image.");
assert.match(receipt.html, /Rp\s?365\.000/, "Receipt must display the verified total.");
assert.match(receipt.html, /midtrans-verified-001/, "Receipt must include the payment reference.");
assert.match(receipt.text, /Total paid/, "Receipt must include a plain-text fallback.");
assert.doesNotMatch(receipt.html, /https:\/\/example\.com/, "Receipt must not contain a placeholder link.");

const [commerce, notifications] = await Promise.all([
  readFile(new URL("../api/_lib/commerce.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_lib/emailNotifications.js", import.meta.url), "utf8")
]);
assert.match(commerce, /products\(image\)/, "The existing order read must include the product image for the receipt.");
assert.doesNotMatch(notifications, /await receiptCatalogImages/, "Receipt rendering must not add an image lookup to the payment webhook path.");

console.log("Payment receipt email contract passed.");

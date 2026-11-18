import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requiresApparelSize, sizePickerMarkup } from "../src/components/sizePicker.js";
import { productMarkup } from "../api/_lib/catalogPage.js";
import { productRowFromFinanceStock } from "../api/_lib/financeState.js";

const sizes = [
  { label: "S", quantity: 1, soldOut: false },
  { label: "M", quantity: 0, soldOut: true },
  { label: "L", quantity: 8, soldOut: false },
  { label: "XL", quantity: 2, soldOut: false }
];
const product = { id: "size-test", sku: "NXP-2026-APP-0007", category: "Apparel", title: "Test tee", artist: "Test", price: 350000, qty: 11, sizes, images: [], raw: {} };
const picker = sizePickerMarkup(product);
assert.match(picker, /data-size-value="M"\s+disabled/);
assert.doesNotMatch(picker, /is-selected/);
assert.match(sizePickerMarkup(product, "L"), /data-size-value="L"[^>]*is-selected/);
const html = productMarkup(product);
assert.match(html, /data-size-value="M"\s+disabled/);
assert.match(html, /data-add-cart="size-test"\s+disabled>Select a size/);
assert.equal(requiresApparelSize(null), false);
assert.equal(requiresApparelSize({ sku: "NXP-2026-APP-0007", category: "Apparel", sizes: [] }), true);
assert.equal(requiresApparelSize({ sku: "NXP-2026-APP-0003", category: "Apparel", sizes: [] }), true);
assert.equal(requiresApparelSize({ sku: "NXP-2026-APP-0004", category: "Apparel", sizes: [] }), true);
const row = productRowFromFinanceStock({ category: "Apparel", apparel_type: "Tops", qty: 11, raw: {} }, { item: "T-shirt", sizes }, 11);
assert.deepEqual(row.sizes, sizes);
const main = await readFile("src/main.js", "utf8");
assert.match(main, /missingSize = Boolean\(requiresApparelSize\(product\)/);
assert.match(main, /requiresApparelSize\(product\) && !button\.closest\("\.product-detail"\)/);
console.log("Apparel size selection and zero-stock preservation passed.");

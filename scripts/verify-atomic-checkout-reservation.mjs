import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260831184251_atomic_checkout_reservation_and_one_hour_expiry.sql", import.meta.url), "utf8");
const handlers = await readFile(new URL("../api/_lib/commerceHandlers.js", import.meta.url), "utf8");
const client = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const email = await readFile(new URL("../api/_lib/emailNotifications.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must be defined by the latest migration.`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} must have a complete SQL body.`);
  return migration.slice(start, end);
}

function assertStableReservationOrder(body, label) {
  const financeLock = body.indexOf("where key = 'main' for update");
  const productLock = body.indexOf("from public.products where id =", financeLock);
  const availabilityCheck = body.indexOf("v_physical_quantity - v_reserved_before", productLock);
  const reservationInsert = body.indexOf("insert into public.inventory_reservations", availabilityCheck);
  const productUpdate = body.indexOf("update public.products set", reservationInsert);
  assert(financeLock >= 0, `${label} must lock Finance state.`);
  assert(productLock > financeLock, `${label} must lock Finance before products.`);
  assert(availabilityCheck > productLock, `${label} must calculate Finance stock minus active reservations.`);
  assert(reservationInsert > availabilityCheck, `${label} must reject unavailable stock before inserting a reservation.`);
  assert(productUpdate > reservationInsert, `${label} must insert the reservation before publishing computed availability.`);
}

const checkout = functionBody("create_checkout_order");
const shippingQuote = functionBody("issue_shipping_quote");
const expiry = functionBody("release_expired_orders");
const payment = functionBody("apply_verified_payment");

assertStableReservationOrder(checkout, "Direct checkout");
assertStableReservationOrder(shippingQuote, "Shipping quote");
assert.match(checkout, /interval '1 hour'/, "Direct checkout must use the one-hour payment window.");
assert.match(shippingQuote, /interval '1 hour'/, "Shipping quotes must use the one-hour payment window.");
assert.match(expiry, /payment_expires_at <= now\(\) - interval '5 minutes'/, "Expiry maintenance must retain the callback grace period.");
assert.match(expiry, /release_order_reservations/, "Expiry must use the Finance-aware release transaction.");
assert.match(payment, /payment_expires_at \+ interval '5 minutes' <= now\(\)/, "Verified payment must accept only the narrow callback grace period.");
assert.match(handlers, /expiry: \{ unit: "hour", duration: 1 \}/, "Midtrans must expire at the same one-hour customer deadline.");
assert.doesNotMatch(email, /two-hour payment window/i, "Current customer email copy must not advertise two hours.");
assert.match(client, /nixp:public-commerce-refreshed/, "The public client must listen for live commerce changes.");
assert.match(client, /setPublicProductSoldOutState/, "Live commerce changes must patch sold-out controls without a full catalog render.");
assert.match(client, /PUBLIC_COMMERCE_REFRESH_MS = 15_000/, "Open public product pages must refresh visible commerce state promptly.");
assert.match(client, /adminStore\.refreshPublicCommerce\(ids\)/, "Live stock checks must be scoped to products currently rendered on the page.");

function reserve(physical, active, requested) {
  const available = Math.max(0, physical - active);
  if (requested > available) return { accepted: false, active, available };
  const nextActive = active + requested;
  return { accepted: true, active: nextActive, available: Math.max(0, physical - nextActive) };
}

const first = reserve(1, 0, 1);
assert.deepEqual(first, { accepted: true, active: 1, available: 0 });
const competing = reserve(1, first.active, 1);
assert.deepEqual(competing, { accepted: false, active: 1, available: 0 }, "A competing checkout must not reserve the final unit twice.");
const afterRelease = reserve(1, 0, 1);
assert.equal(afterRelease.accepted, true, "A released reservation must make the unit sellable again.");

console.log("Atomic one-hour checkout reservation contract passed.");

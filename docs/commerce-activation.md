# NIXP Commerce Activation

The commerce database foundation is live in Supabase. Public checkout always
creates a two-hour server-priced reservation; it never records finance revenue
or permanently deducts inventory before a verified payment.

## Status model

Each order has separate `order_status`, `payment_status`,
`fulfillment_status`, and `shipping_status` fields. `payment_status = Paid`
can only be set by the verified Midtrans webhook database function.

Stock is held as a two-hour reservation. A paid order converts its reservation
to sold stock. Expired, cancelled, denied, or failed payments release stock.

## Required Vercel production variables

Set all values as sensitive Production variables:

```text
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY=<server key from Midtrans>
```

The Midtrans server key stays on the server. Never expose it in `src/`, the
browser, GitHub, or Supabase client code.

With a sandbox server key present, checkout creates a Snap payment session and
redirects the customer to Midtrans. Do not add production keys until the full
sandbox checklist below passes. The client key is not needed because NIXP uses
Midtrans's server-created redirect session rather than exposing payment setup
credentials in browser code.

## Provider configuration

Configure Midtrans to call this exact HTTPS notification URL:

```text
https://nix-p.com/api/webhooks/midtrans
```

The endpoint verifies the Midtrans SHA-512 signature and then fetches the
provider transaction status itself before it marks an order as paid.

Supabase runs the payment-expiry function every five minutes inside Postgres.
The scheduler is recorded in the migration history, so it is not dependent on
the Vercel plan or an external HTTP request.

Checkout request limits, webhook receipt claims, and the transactional email
outbox are also stored in Supabase. Failed emails remain retryable instead of
being silently lost. A staff visit to the protected orders view and every
checkout/payment request drain due outbox messages; add a protected background
worker before production volume grows.

## Shipping next

The schema has shipping quotes and shipment records. Before enabling JNE or a
JNE aggregator such as Biteship, collect recipient name, phone, address,
district, city/regency, province, postal code, and service selection at
checkout. Populate the existing product weight and packed dimensions, then
create the server-side quote endpoint. Do not accept shipping prices from the
browser.

## Operational rules

- Finance revenue is recorded only after verified payment, never at cart submit.
- `order_events` is the audit history for operational changes.
- A paid order moves to `Processing`; admin operations can move it through
  `Packed`, `Ready for Pickup`, `In Transit`, and `Delivered` with a tracking
  number.
- Refunds and returns remain admin-reviewed workflows. Returned music stock is
  not automatically made available again.
- Complete a real sandbox run for: successful payment, pending payment,
  expiry, denied payment, duplicate webhook, wrong amount, last-unit race, and
  refund before switching `MIDTRANS_ENV` to `production`.

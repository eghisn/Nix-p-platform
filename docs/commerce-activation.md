# NIXP Commerce Activation

The commerce database foundation is live in Supabase. Public checkout always
creates a one-hour server-priced reservation; it never records finance revenue
or permanently deducts inventory before a verified payment.

## Status model

Each order has separate `order_status`, `payment_status`,
`fulfillment_status`, and `shipping_status` fields. `payment_status = Paid`
can only be set by the verified Midtrans webhook database function.

Stock is held as a one-hour reservation. A paid order converts its reservation
to sold stock. Expired, cancelled, denied, or failed payments release stock.

## Required Vercel production variables

Set all values as sensitive Production variables:

```text
MIDTRANS_ENV=sandbox
MIDTRANS_ENABLED=false
MIDTRANS_MERCHANT_ID=<merchant ID from the same Midtrans environment>
MIDTRANS_SERVER_KEY=<server key from Midtrans>
```

The Midtrans server key stays on the server. Never expose it in `src/`, the
browser, GitHub, or Supabase client code.

Keep `MIDTRANS_ENABLED=false` while adding or rotating credentials. Set it to
`true` only for an intentional sandbox or production activation. With matching
sandbox credentials and the switch enabled, checkout creates a Snap payment
session and redirects the customer to Midtrans. Do not add production keys until
the full sandbox checklist below passes. The client key is not needed because
NIXP uses Midtrans's server-created redirect session rather than exposing payment
setup credentials in browser code.

## Provider configuration

Configure Midtrans to call this exact HTTPS notification URL:

```text
https://nix-p.com/api/webhooks/midtrans
```

The endpoint verifies the Midtrans SHA-512 signature and then fetches the
provider transaction status itself before it marks an order as paid.

Supabase runs `nixp_commerce_maintenance()` every five minutes inside Postgres.
The active job is named `nixp-expire-pending-orders`; verify its recent runs in
`cron.job_run_details` before each payment launch. This scheduler releases
expired stock independently of Vercel and customer requests. The daily Vercel
maintenance route is a secondary operations pass, not the primary expiry clock.

Checkout request limits, webhook receipt claims, and the transactional email
outbox are also stored in Supabase. Failed emails remain retryable instead of
being silently lost. Payment creation never waits for expiry cleanup or email
delivery. The protected Orders view reports stuck payment attempts, failed
webhooks, overdue reservations, and failed notifications, and can reconcile
pending attempts directly against Midtrans.

Every Snap create request uses a deterministic Midtrans `Idempotency-Key` tied
to the NIXP order ID. A timed-out request reuses that key and checks Midtrans
status before attempting provider recovery.

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
- After changing Midtrans credentials, redeploy and confirm the protected Orders
  payment-health panel reports the expected environment with no missing fields.
- Keep `MIDTRANS_ENABLED=false` as the emergency stop. Disabling it prevents new
  sessions while preserving orders, reservations, webhooks, and Finance history.

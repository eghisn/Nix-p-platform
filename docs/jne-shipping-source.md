# NIXP JNE Official Source Contract

Inspected on 2 August 2026.

## Source priority

1. Authenticated JNE Shipping API at `https://shipping.jne.co.id`
2. Official public JNE destination search and shipping-fee checker
3. A previously cached official response within the configured maximum stale period

Rates are never interpolated, multiplied, estimated, or accepted from the browser.

## Authenticated API

The official JNE WooCommerce plugin documents these server-side endpoints:

- `GET /v1/jne/provinces`
- `GET /v1/jne/cities`
- `GET /v1/jne/districts`
- `GET /v1/jne/destination?zip_code=...`
- `GET /v1/jne/service-codes`
- `GET /v1/jne/origin?name=...`
- `POST /v1/jne/tariff-zip-code`

Requests use the JNE-issued `access_key` in the `Authorization` header. NIXP stores it only as the server-side `JNE_API_ACCESS_KEY` environment variable.

Tariff request fields:

```json
{
  "from": "CGK10000",
  "thru": "BDO10000",
  "weight": "1"
}
```

## Official public endpoints

- Destination search: `GET https://www.jne.co.id/api-destination?search=Bandung`
- Origin search: `GET https://www.jne.co.id/api-origin?search=Jakarta`
- Tariff checker: `GET https://www.jne.co.id/en/shipping-fee?origin=CGK10000&destination=BDO10000&weight=1`

The public checker is used on demand with controlled request volume and local caching. Complete nationwide synchronization is deliberately disabled until JNE provides NIXP with an authenticated `access_key`.

The canonical Jakarta origin returned by the official origin search is `CGK10000`. It is stored in `shipping_settings` and remains admin configurable.

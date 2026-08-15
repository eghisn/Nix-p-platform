# NIXP Website Prototype

Local deployable prototype for the NIXP public website and admin area.

## Run locally

```bash
npm run dev
```

Open `http://localhost:4173`.

The local dev server also provides the editor write API. Use this mode when adding products or uploading product images.

## Build

```bash
npm run build
```

The static site is generated in `dist/`. Vercel is configured through `vercel.json` to build with `npm run build`, serve `dist`, and rewrite routes back to `index.html` for the app router.

## Structure

- `src/data/sampleData.js` contains sample products, inventory, orders, requests, and cashflow.
- `public/data/admin-store.json` is the local editor snapshot used by the public site and admin preview.
- `public/uploads/products/` stores images uploaded through the local editor.
- `api/_lib/supabase.js` is the server-side Supabase gateway. The public catalog is served from Supabase with the committed public snapshot used as a reconciliation fallback.
- `src/main.js` defines the public and admin routes.
- `src/components/layout.js` contains shared layout, card, hero, and table rendering.
- `src/styles/base.css` contains the NIXP visual system.

## Production data architecture

Supabase is the production database and server-side authority for products, inventory, orders, requests, offers, cashflow, shipping, payment attempts, notification outbox, and uploaded product images. Public pages use a short-lived CDN response plus the committed `public/data/public-store.json` snapshot as a deterministic fallback. The server reconciles the snapshot without allowing stale finance rows to overwrite newer editorial data.

- Public site: `nix-p.com`, built by GitHub and deployed on Vercel.
- Admin editor: `admin.nix-p.com`, authenticated server routes; publishing writes Supabase, creates an internal backup, then optionally commits the public snapshot through the protected deploy route.
- Finance: `finance.nix-p.com`, authenticated server routes; inventory and finance changes are synchronized into the catalog through the maintenance job.
- Shipping: `NixpShippingEngine` owns packaging, quotes, immutable internal tariff snapshots, quote validation, expiry, and scheduled health/coverage checks.
- Payments: Midtrans is server-created and server-verified. Browser prices are never trusted.
- Email: Resend sends through the durable notification outbox; failed messages are retried and visible in the Admin health panel.

Copy `.env.example` to `.env.local` for local work. Never commit `.env.local`, service-role keys, payment keys, deploy tokens, SMTP passwords, or backup encryption keys.

## Publishing and recovery runbook

1. Edit and save through the authenticated Admin editor.
2. Confirm the item status and preview. A product is not public until required publication fields and inventory availability pass the server-side guard.
3. Use Deploy. The route writes Supabase first, backs up the store, commits the public snapshot when `GITHUB_DEPLOY_TOKEN` is configured, and lets Vercel build from the push.
4. Check the deployment and the public route. Do not edit the generated snapshot by hand.
5. Before schema changes, apply the matching migration to Supabase and verify RLS/advisors. Existing ledger rows are never reseeded or deleted.

The repository includes `npm run backup:supabase`, which creates an AES-256-GCM encrypted export of operational tables. Configure `NIXP_BACKUP_ENCRYPTION_KEY`, run it from a scheduled trusted machine, copy the encrypted file to an independent storage provider, and retain at least 90 days. Supabase daily backups are not a replacement for an offsite copy; enable PITR after upgrading to a paid plan and test a restore quarterly. Storage objects require a separate backup plan.

Rotate `NIXP_SESSION_SECRET`, deploy tokens, Resend, Midtrans, JNE, and backup keys through Vercel/Supabase secret management, never through source files. After rotation, redeploy and test login, checkout, webhook, email, shipping quote, and Admin Deploy.

## Integrations and monitoring

- Vercel production deployments come from GitHub. Reauthorize the Vercel GitHub/project integration with deployment and runtime-log read access if inspection returns HTTP 403.
- The API records sanitized production errors in the server-only `system_events` table. Do not store request bodies, passwords, payment credentials, or service keys there.
- The daily `/api/commerce-maintenance` cron expires quotes/orders, drains email retries, synchronizes finance inventory, and validates the active shipping snapshot. Review `shipping_validation_runs` and `shipping_source_events`; a missing or stale active rate version is a failure, not a silent fallback.
- Midtrans setup requires server and client keys in Vercel, the correct environment, an HTTPS webhook URL, and a tested signature-verified webhook. JNE rate snapshots require an active version and a recent validation run.

If the seed data changes and you need to regenerate the local snapshot:

```bash
npm run seed:admin
```

## Private workspace plan

- `nix-p.com`: public storefront, deployed from GitHub to Vercel.
- `admin.nix-p.com`: private website/admin editor, required login.
- `finance.nix-p.com`: private cashflow/finance workspace, required login.

For production, use Vercel environment variables for secrets and server-side login checks. Every production Supabase table used by the application must have RLS enabled; service-role access is limited to server routes and never exposed in client JavaScript.

Local credentials are read from:

```bash
NIXP_ADMIN_USERNAME=
NIXP_ADMIN_PASSWORD=
NIXP_FINANCE_USERNAME=
NIXP_FINANCE_PASSWORD=
NIXP_AUTH_ALLOWLIST=
```

`NIXP_AUTH_ALLOWLIST` is optional and accepts comma-separated IP addresses for local prototype access control.

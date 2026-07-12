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
- `src/services/catalogService.js` is the future Supabase connection point.
- `src/main.js` defines the public and admin routes.
- `src/components/layout.js` contains shared layout, card, hero, and table rendering.
- `src/styles/base.css` contains the NIXP visual system.

## Supabase later

When credentials and schema are ready, replace the functions in `src/services/catalogService.js` with Supabase queries. Suggested tables:

- `products`
- `inventory`
- `orders`
- `order_items`
- `request_items`
- `cashflow_entries`

Supabase Auth can be connected to `/login`, with protected route checks added before rendering `/admin` pages.

Copy `.env.example` to `.env.local` when Supabase credentials are available.

## Local editor as backend

The prototype editor is file-backed when it runs through `npm run dev`.

- Product/image saves update `public/data/admin-store.json`.
- Uploaded product images are written to `public/uploads/products/`.
- Commit both the JSON file and uploaded image files before pushing to GitHub/Vercel.
- Static builds on Vercel cannot write these files at runtime; Supabase Storage and database tables should replace the local write API when production credentials are ready.

If the seed data changes and you need to regenerate the local snapshot:

```bash
npm run seed:admin
```

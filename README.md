# NIXP Website Prototype

Local deployable prototype for the NIXP public website and admin area.

## Run locally

```bash
npm run dev
```

Open `http://localhost:4173`.

## Build

```bash
npm run build
```

The static site is generated in `dist/`. Vercel is configured through `vercel.json` to build with `npm run build`, serve `dist`, and rewrite routes back to `index.html` for the app router.

## Structure

- `src/data/sampleData.js` contains sample products, inventory, orders, requests, and cashflow.
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

# NIXP Catalog Pipeline

This file records the catalog rules that must remain true across Finance, Admin,
Supabase, GitHub, Vercel, and the public storefront.

## Ownership

- Finance is the source of truth for SKU, landed unit cost, selling price,
  quantity, condition, artist, title, and optional edition identifiers.
- Admin is the source of truth for editorial copy, images, related artists,
  publishing state, collections, and presentation.
- Supabase is the live operational database. Public pages read published rows
  from Supabase; GitHub snapshots provide deploy-time HTML and disaster recovery.
- GitHub and Vercel deployments provide crawler-readable route HTML, social
  metadata, sitemap entries, and the current public-only asset archive. Private
  Admin and Finance snapshots must never be refreshed into the public repository.

## Finance To Catalog

1. A purchase creates or updates one inventory stock row by normalized SKU.
2. After title and selling price exist, the server synchronizes the SKU to Admin.
3. Exact reviewed matches use the curated enrichment registry.
4. Other record releases are matched through MusicBrainz using artist, title,
   format, and, when supplied, barcode or catalog number.
5. Edition, barcode, and catalog number should be entered whenever known. They
   are required to distinguish pressings that share artist, title, and format.
6. A release is public only when it has artist, title, label, release year,
   description, price, and a real cover image.

## Image Rules

- The first image is always the actual release cover artwork.
- New products may include a real physical-format product image from an official
  label, artist store, or reputable retailer.
- Used products receive cover artwork only from automatic enrichment. Additional
  used-item images must be photographs of NIXP's actual physical copy.
- Generated mockups, NIXP paper bands, and sample product images must never be
  used for live releases.
- Every sourced image keeps a courtesy label and source URL.

## Related Artists

- Related artists are editorial relationships, not arbitrary similarity tags.
- A tag is clickable only when that artist currently has a public NIXP product.
- Artist route slugs are derived consistently from the canonical artist name.
- Adding a record-format Finance item must also add its artist to the Admin and
  public artist directory.

## Search And Crawlers

- Every public product and artist route must have server-readable HTML.
- Product pages must include canonical, Open Graph, Twitter, Product, Offer, and
  BreadcrumbList metadata.
- The build must generate `sitemap.xml` and `robots.txt`.
- Product structured prices come from the server database, never browser state.
- Admin, Finance, APIs, and login routes are excluded from search indexing.

## Deployment And Recovery

- Every Admin or Finance write is backed up in `store_backups` before mutation.
- `scripts/sync-catalog-snapshots.mjs` refreshes the public GitHub snapshot and
  local ignored Admin snapshot from Supabase, then verifies the curated Finance
  SKUs are public.
- A GitHub push triggers Vercel; public Supabase data remains the live source
  between deployments.
- Never overwrite an Admin-uploaded image or editorial field with a weaker
  automatic value.

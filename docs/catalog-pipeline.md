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
4. Other record releases use official Bandcamp physical-package data and
   MusicBrainz release identity. A supplied barcode/catalog number must match;
   a digital release, artist name, or a format mentioned elsewhere on a page
   is not evidence of the physical edition. Discogs discovery is disabled.
   Cover Art Archive can provide verified release artwork, but neither it nor
   MusicBrainz supplies description or review prose. Covers are copied into
   NIXP's Supabase Storage before public use.
5. Edition, barcode, and catalog number should be entered whenever known. They
   are required to distinguish pressings that share artist, title, and format.
6. A release is public only when it has artist, title, label, release year,
   description, price, and a real cover image. A metadata fingerprint makes a
   Finance title, artist, format, barcode, or catalog-number change re-enrich
   that specific SKU without overwriting manual Admin edits.
7. Automatic enrichment supplies verified release metadata, cover art, courtesy,
   descriptive copy, and clickable catalog relationships when a verified artist
   relationship exists. Source-backed review quotes remain editorial: the system
   never invents a quote or attribution.

## Editorial Research

- Descriptions use the reviewed original-copy registry after release matching.
  Registry entries are release-level, not pressing-level, and include an
  official label/artist or music-publication source URL. They never change the
  matched barcode, edition, stock, or price.
- There is no paid writing API and no general-purpose automatic prose writer.
  An unreviewed release stays `needs-editorial-quality`, with discovered source
  links available to the editor. Do not turn metadata, search snippets, track
  counts, or copied label paragraphs into a purported original description.
- Review discovery admits only approved music publications; official release
  notes are separately labeled. URLs, redirects and artist/release identity
  are validated. Discogs and MusicBrainz links cannot be editorial fallbacks.
- Review discovery runs independently of the release metadata provider. A
  Bandcamp match or an existing reviewed description must not bypass reviews.
  Search uses bounded provider fallbacks; saved verified release identity can
  be reused only when its identifiers and edition still match Finance.
- Reviewed track excerpts identify the actual song in the source label; they
  are not presented as a review of the entire EP. News announcements and label
  sales copy do not qualify as automatically discovered critical reviews.
- Review status and source failures are retained separately from publication
  readiness. An incomplete review is visible in Admin and does not silently
  become a successful all-fields-complete result or unpublish a live product.
- Manual descriptions remain authoritative. A failed/missing new editorial
  result must not erase previously verified copy. Research remains SKU-scoped
  and preserves the existing publication state; completing a draft is not an
  instruction to publish it.

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

- Related artists are built from two independent sources: explicit MusicBrainz
  artist/release relationships and Last.fm similar-artist results. They are
  deduplicated, source-labeled, and combined to a maximum of five names. There
  is no NIXP-availability weighting and neither source is treated as a mere
  fallback. Last.fm is optional at runtime: if `LASTFM_API_KEY` is absent or
  temporarily unavailable, MusicBrainz results remain usable and publication
  does not fail solely because Last.fm is unavailable.
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

-- Private Collection offers are private business records. Public visitors submit
-- through the server endpoint; no browser role receives direct table access.
create table if not exists public.offers (
  id text primary key,
  name text,
  title text,
  status text not null default 'New',
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists offers_status_idx on public.offers (status);
create index if not exists offers_created_at_idx on public.offers (created_at desc);
alter table public.offers enable row level security;

drop policy if exists "Private server access only" on public.offers;
create policy "Private server access only"
  on public.offers as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table public.products
  add column if not exists open_to_offers boolean not null default false,
  add column if not exists minimum_acceptable_offer integer;

alter table public.products
  drop constraint if exists products_minimum_acceptable_offer_check;
alter table public.products
  add constraint products_minimum_acceptable_offer_check
  check (minimum_acceptable_offer is null or minimum_acceptable_offer >= 0);

revoke all on public.offers from anon, authenticated;
grant usage on schema public to anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.products (
  id text primary key,
  sku text,
  title text not null,
  artist text,
  category text,
  format text,
  display_format text,
  apparel_type text,
  condition text,
  price integer not null default 0,
  year integer,
  label text,
  collection text,
  color text,
  material text,
  image text,
  images jsonb not null default '[]'::jsonb,
  image_credits jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  details jsonb not null default '[]'::jsonb,
  sizes jsonb not null default '[]'::jsonb,
  description text,
  qty integer not null default 0,
  publish_status text not null default 'Published',
  visibility text not null default 'Public',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artists (
  id text primary key,
  name text,
  title text,
  status text,
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collections (
  id text primary key,
  name text,
  title text,
  status text,
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requests (
  id text primary key,
  name text,
  title text,
  status text,
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  name text,
  title text,
  status text,
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cashflow (
  id text primary key,
  name text,
  title text,
  status text,
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id text primary key,
  name text,
  title text,
  status text,
  sort integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products (category);
create index if not exists products_format_idx on public.products (format);
create index if not exists products_label_idx on public.products (label);
create index if not exists products_public_idx on public.products (publish_status, visibility);

alter table public.products enable row level security;
alter table public.artists enable row level security;
alter table public.collections enable row level security;
alter table public.requests enable row level security;
alter table public.orders enable row level security;
alter table public.cashflow enable row level security;
alter table public.inventory enable row level security;

drop policy if exists "Public can read published products" on public.products;
create policy "Public can read published products"
  on public.products for select
  to anon
  using (publish_status = 'Published' and visibility = 'Public');

drop policy if exists "Public can read published artists" on public.artists;
create policy "Public can read published artists"
  on public.artists for select
  to anon
  using (status = 'Published');

drop policy if exists "Public can read published collections" on public.collections;
create policy "Public can read published collections"
  on public.collections for select
  to anon
  using (status = 'Published');

grant usage on schema public to anon, authenticated;
grant select on public.products, public.artists, public.collections to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read product images" on storage.objects;
create policy "Public can read product images"
  on storage.objects for select
  to anon
  using (bucket_id = 'product-images');

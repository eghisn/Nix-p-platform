create table if not exists public.store_backups (
  id text primary key,
  source text not null,
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists store_backups_source_created_idx
  on public.store_backups (source, created_at desc);

alter table public.store_backups enable row level security;

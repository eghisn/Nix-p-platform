alter table public.artists add column if not exists title text;
alter table public.collections add column if not exists name text;
alter table public.artists add column if not exists updated_at timestamptz not null default now();
alter table public.collections add column if not exists updated_at timestamptz not null default now();
alter table public.requests add column if not exists updated_at timestamptz not null default now();
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.cashflow add column if not exists updated_at timestamptz not null default now();
alter table public.inventory add column if not exists updated_at timestamptz not null default now();

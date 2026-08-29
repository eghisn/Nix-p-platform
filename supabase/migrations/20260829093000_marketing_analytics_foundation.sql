-- Consent-gated, pseudonymous web analytics. No customer email, IP address,
-- payment data, or marketing-message consent is stored in these tables.

create table if not exists public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  event_type text not null check (event_type in ('page_view', 'product_view', 'product_click', 'add_to_cart', 'cart_open', 'checkout_started')),
  anonymous_session_id uuid not null,
  page_path text not null check (left(page_path, 1) = '/'),
  product_id text,
  source text,
  medium text,
  campaign text,
  term text,
  content text,
  country_code char(2),
  device_type text not null default 'unknown' check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists marketing_events_occurred_at_idx
  on public.marketing_events (occurred_at desc);
create index if not exists marketing_events_session_idx
  on public.marketing_events (anonymous_session_id, occurred_at desc);
create index if not exists marketing_events_campaign_idx
  on public.marketing_events (source, medium, campaign, occurred_at desc);
create index if not exists marketing_events_product_idx
  on public.marketing_events (product_id, occurred_at desc)
  where product_id is not null;

create table if not exists public.marketing_daily_metrics (
  metric_date date primary key,
  sessions integer not null default 0 check (sessions >= 0),
  unique_sessions integer not null default 0 check (unique_sessions >= 0),
  page_views integer not null default 0 check (page_views >= 0),
  product_views integer not null default 0 check (product_views >= 0),
  product_clicks integer not null default 0 check (product_clicks >= 0),
  add_to_cart_count integer not null default 0 check (add_to_cart_count >= 0),
  checkout_starts integer not null default 0 check (checkout_starts >= 0),
  orders_paid integer not null default 0 check (orders_paid >= 0),
  gross_sales integer not null default 0 check (gross_sales >= 0),
  refunds integer not null default 0 check (refunds >= 0),
  net_sales integer not null default 0,
  generated_at timestamptz not null default now()
);

create table if not exists public.marketing_campaign_sources (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  medium text not null default '',
  campaign text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sessions integer not null default 0 check (sessions >= 0),
  page_views integer not null default 0 check (page_views >= 0),
  checkout_starts integer not null default 0 check (checkout_starts >= 0),
  unique (source, medium, campaign)
);

alter table public.marketing_events enable row level security;
alter table public.marketing_daily_metrics enable row level security;
alter table public.marketing_campaign_sources enable row level security;

revoke all on table public.marketing_events, public.marketing_daily_metrics, public.marketing_campaign_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.marketing_events, public.marketing_daily_metrics, public.marketing_campaign_sources to service_role;

create policy marketing_events_service_role_all
  on public.marketing_events for all to service_role using (true) with check (true);
create policy marketing_daily_metrics_service_role_all
  on public.marketing_daily_metrics for all to service_role using (true) with check (true);
create policy marketing_campaign_sources_service_role_all
  on public.marketing_campaign_sources for all to service_role using (true) with check (true);

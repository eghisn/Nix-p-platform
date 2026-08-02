alter table public.shipping_settings
  add column if not exists jne_origin_code text,
  add column if not exists jne_rate_cache_ttl_hours integer not null default 24 check (jne_rate_cache_ttl_hours between 1 and 720),
  add column if not exists jne_rate_max_stale_hours integer not null default 168 check (jne_rate_max_stale_hours between 1 and 2160),
  add column if not exists quote_ttl_minutes integer not null default 15 check (quote_ttl_minutes between 5 and 120),
  add column if not exists prewarm_destinations jsonb not null default '[]'::jsonb;

update public.shipping_settings
set jne_origin_code = coalesce(nullif(jne_origin_code, ''), 'CGK10000'),
    origin = 'CGK10000',
    origin_name = 'NIXP Jakarta'
where id = 'default';

create table if not exists public.jne_destinations (
  id uuid primary key default gen_random_uuid(),
  jne_destination_code text not null unique,
  destination_name text not null,
  province_name text not null default '',
  city_or_regency_name text not null default '',
  district_name text,
  subdistrict_name text,
  postal_code text,
  normalized_search_text text not null,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  source_timestamp timestamptz,
  raw_source_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jne_destinations_active_search_idx on public.jne_destinations (active, normalized_search_text text_pattern_ops);
create index if not exists jne_destinations_postal_idx on public.jne_destinations (postal_code) where active;

create table if not exists public.shipping_destinations (
  id uuid primary key default gen_random_uuid(),
  jne_destination_id uuid references public.jne_destinations(id) on delete restrict,
  country_code text not null default 'ID',
  province_code text,
  province_name text not null,
  city_code text,
  city_name text not null,
  district_code text,
  district_name text,
  subdistrict_code text,
  subdistrict_name text,
  postal_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, province_name, city_name, district_name, subdistrict_name, postal_code)
);

create table if not exists public.shipping_services (
  id uuid primary key default gen_random_uuid(),
  courier_name text not null,
  service_code text not null,
  service_name text not null,
  description text,
  estimated_days_min integer check (estimated_days_min is null or estimated_days_min >= 0),
  estimated_days_max integer check (estimated_days_max is null or estimated_days_max >= estimated_days_min),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (courier_name, service_code)
);

create table if not exists public.shipping_rate_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  effective_from date not null,
  effective_until date,
  status text not null check (status in ('draft', 'active', 'archived')),
  source text not null default 'JNE_OFFICIAL',
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  check (effective_until is null or effective_until >= effective_from)
);

create unique index if not exists shipping_rate_versions_one_active_idx on public.shipping_rate_versions ((status)) where status = 'active';

alter table if exists public.shipping_rates rename to shipping_rates_legacy;

create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  rate_version_id uuid not null references public.shipping_rate_versions(id) on delete restrict,
  origin_code text not null,
  destination_id uuid not null references public.shipping_destinations(id) on delete restrict,
  shipping_service_id uuid not null references public.shipping_services(id) on delete restrict,
  weight_from_kg integer not null check (weight_from_kg >= 1),
  weight_to_kg integer not null check (weight_to_kg >= weight_from_kg),
  rate integer not null check (rate >= 0),
  surcharge integer not null default 0 check (surcharge >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rate_version_id, origin_code, destination_id, shipping_service_id, weight_from_kg, weight_to_kg)
);

create index if not exists shipping_rates_lookup_v2_idx on public.shipping_rates (rate_version_id, origin_code, destination_id, shipping_service_id, weight_from_kg, weight_to_kg) where active;

create table if not exists public.jne_tariff_cache (
  id text primary key,
  origin_code text not null,
  destination_code text not null,
  chargeable_weight_kg integer not null check (chargeable_weight_kg between 1 and 100),
  service_code text not null,
  service_name text not null,
  shipment_type text,
  rate integer not null check (rate >= 0),
  estimated_days_min integer,
  estimated_days_max integer,
  estimated_delivery_raw text,
  fetched_at timestamptz not null,
  valid_until timestamptz not null,
  source text not null check (source = 'JNE_OFFICIAL'),
  source_method text not null,
  raw_source_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('available', 'unavailable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origin_code, destination_code, chargeable_weight_kg, service_code)
);

create index if not exists jne_tariff_cache_lookup_idx on public.jne_tariff_cache (origin_code, destination_code, chargeable_weight_kg, valid_until desc);
create index if not exists jne_tariff_cache_stale_idx on public.jne_tariff_cache (status, valid_until);

create table if not exists public.shipping_quote_sessions (
  id uuid primary key,
  token_hash text not null,
  cart_fingerprint text not null,
  origin_code text not null,
  destination_code text not null,
  packaging jsonb not null,
  options jsonb not null,
  source_snapshot jsonb not null,
  status text not null default 'active' check (status in ('active', 'expired', 'used', 'cancelled')),
  expires_at timestamptz not null,
  last_validated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists shipping_quote_sessions_expiry_idx on public.shipping_quote_sessions (status, expires_at);
create index if not exists shipping_quote_sessions_fingerprint_idx on public.shipping_quote_sessions (cart_fingerprint, destination_code);

create table if not exists public.shipping_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('destination-sync', 'tariff-refresh', 'prewarm', 'validation', 'health-check')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shipping_sync_jobs_one_running_type_idx on public.shipping_sync_jobs (job_type) where status = 'running';
create index if not exists shipping_sync_jobs_queue_idx on public.shipping_sync_jobs (status, next_attempt_at, created_at);

create table if not exists public.shipping_source_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shipping_source_events_recent_idx on public.shipping_source_events (created_at desc, status);

create table if not exists public.shipping_validation_runs (
  id uuid primary key default gen_random_uuid(),
  sample_size integer not null,
  matched_count integer not null default 0,
  mismatch_count integer not null default 0,
  status text not null check (status in ('running', 'passed', 'failed')),
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'jne_destinations', 'shipping_destinations', 'shipping_services', 'shipping_rate_versions',
    'shipping_rates', 'jne_tariff_cache', 'shipping_quote_sessions', 'shipping_sync_jobs',
    'shipping_source_events', 'shipping_validation_runs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;

grant usage, select on sequence public.shipping_source_events_id_seq to service_role;

create or replace function public.activate_shipping_rate_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not exists (select 1 from public.shipping_rate_versions where id = p_version_id and status = 'draft') then
    raise exception 'DRAFT_RATE_VERSION_NOT_FOUND';
  end if;
  update public.shipping_rate_versions set status = 'archived', effective_until = current_date - 1 where status = 'active';
  update public.shipping_rate_versions set status = 'active', activated_at = now(), effective_until = null where id = p_version_id;
  select to_jsonb(v) into result from public.shipping_rate_versions v where id = p_version_id;
  return result;
end;
$$;

revoke all on function public.activate_shipping_rate_version(uuid) from public, anon, authenticated;
grant execute on function public.activate_shipping_rate_version(uuid) to service_role;

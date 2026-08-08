alter table public.shipping_rate_versions
  add column if not exists acquisition_summary jsonb not null default '{}'::jsonb,
  add column if not exists destination_count integer not null default 0 check (destination_count >= 0),
  add column if not exists rate_count integer not null default 0 check (rate_count >= 0),
  add column if not exists verified_at timestamptz;

create or replace view public.active_shipping_rates
with (security_invoker = true)
as
select
  r.id as rate_id,
  r.origin_code,
  jd.jne_destination_code as destination_code,
  d.city_code as local_region_code,
  d.city_name as destination_name,
  s.service_code,
  s.service_name,
  s.description,
  coalesce(s.estimated_days_min, 0) as estimated_days_min,
  coalesce(s.estimated_days_max, s.estimated_days_min, 0) as estimated_days_max,
  r.weight_from_kg,
  r.weight_to_kg,
  r.rate,
  r.surcharge,
  (r.rate + r.surcharge) as total_rate,
  v.id as rate_version_id,
  v.name as rate_version_name,
  v.effective_from,
  v.activated_at,
  v.source
from public.shipping_rates r
join public.shipping_rate_versions v on v.id = r.rate_version_id
join public.shipping_destinations d on d.id = r.destination_id
join public.jne_destinations jd on jd.id = d.jne_destination_id
join public.shipping_services s on s.id = r.shipping_service_id
where v.status = 'active'
  and r.active
  and d.active
  and jd.active
  and s.active
  and v.effective_from <= current_date
  and (v.effective_until is null or v.effective_until >= current_date);

revoke all on table public.active_shipping_rates from public, anon, authenticated;
grant select on table public.active_shipping_rates to service_role;

create index if not exists shipping_destinations_city_code_active_idx
  on public.shipping_destinations (city_code)
  where active;

create index if not exists shipping_rate_versions_status_effective_idx
  on public.shipping_rate_versions (status, effective_from desc);

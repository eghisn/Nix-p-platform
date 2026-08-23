alter table public.shipping_rates
  add column if not exists estimated_days_min integer check (estimated_days_min is null or estimated_days_min >= 0),
  add column if not exists estimated_days_max integer check (estimated_days_max is null or estimated_days_max >= estimated_days_min),
  add column if not exists estimated_delivery_raw text,
  add column if not exists source_checksum text,
  add column if not exists acquired_at timestamptz;

drop view if exists public.active_shipping_rates;

create view public.active_shipping_rates
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
  coalesce(r.estimated_days_min, s.estimated_days_min, 0) as estimated_days_min,
  coalesce(r.estimated_days_max, r.estimated_days_min, s.estimated_days_max, s.estimated_days_min, 0) as estimated_days_max,
  r.estimated_delivery_raw,
  r.weight_from_kg,
  r.weight_to_kg,
  r.rate,
  r.surcharge,
  (r.rate + r.surcharge) as total_rate,
  r.source_checksum,
  r.acquired_at,
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

create index if not exists shipping_rates_active_snapshot_lookup_idx
  on public.shipping_rates (rate_version_id, origin_code, destination_id, weight_from_kg, weight_to_kg)
  where active;

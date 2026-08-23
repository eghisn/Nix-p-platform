create table if not exists public.shipping_settings (
  id text primary key,
  origin text not null,
  origin_name text not null,
  volumetric_divisor integer not null default 6000 check (volumetric_divisor > 0),
  calculator_version text not null default 'nixp-rule-v1',
  updated_at timestamptz not null default now()
);

create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  destination_code text not null,
  destination_name text not null,
  courier text not null,
  service text not null,
  eta text,
  chargeable_weight_kg integer not null check (chargeable_weight_kg between 1 and 100),
  rate integer not null check (rate >= 0),
  effective_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shipping_rates_identity_idx
  on public.shipping_rates (origin, destination_code, courier, service, chargeable_weight_kg, effective_date);
create index if not exists shipping_rates_lookup_idx
  on public.shipping_rates (origin, destination_code, active, courier, service, chargeable_weight_kg, effective_date desc);

insert into public.shipping_settings (id, origin, origin_name, volumetric_divisor, calculator_version)
values ('default', 'JAKARTA', 'Jakarta', 6000, 'nixp-rule-v1')
on conflict (id) do nothing;

alter table public.shipping_settings enable row level security;
alter table public.shipping_rates enable row level security;
revoke all on table public.shipping_settings from public, anon, authenticated;
revoke all on table public.shipping_rates from public, anon, authenticated;
grant select, insert, update, delete on table public.shipping_settings to service_role;
grant select, insert, update, delete on table public.shipping_rates to service_role;

create or replace function public.issue_rule_based_shipping_quote(
  p_order_id text,
  p_amount integer,
  p_courier text,
  p_service text,
  p_eta text,
  p_packages jsonb,
  p_rate_ids jsonb,
  p_calculator_version text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_payload jsonb;
begin
  if jsonb_typeof(p_packages) <> 'array' or jsonb_array_length(p_packages) = 0 then
    raise exception 'SHIPPING_PACKAGES_REQUIRED';
  end if;
  if jsonb_typeof(p_rate_ids) <> 'array' or jsonb_array_length(p_rate_ids) <> jsonb_array_length(p_packages) then
    raise exception 'SHIPPING_RATE_EVIDENCE_REQUIRED';
  end if;
  if p_amount < 0 then raise exception 'INVALID_SHIPPING_AMOUNT'; end if;

  v_payload := jsonb_build_object(
    'calculatorVersion', left(coalesce(p_calculator_version, ''), 80),
    'packages', p_packages,
    'rateIds', p_rate_ids,
    'calculatedAt', now()
  );

  v_result := public.issue_shipping_quote(p_order_id, p_amount, p_courier, p_service, p_eta);

  update public.order_records
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('shippingCalculation', v_payload),
      updated_at = now()
  where id = p_order_id;

  update public.shipping_quotes
  set provider = 'NIXP Rule Calculator',
      payload = coalesce(payload, '{}'::jsonb) || v_payload,
      updated_at = now()
  where id = (
    select id from public.shipping_quotes
    where order_id = p_order_id and status = 'Sent'
    order by created_at desc limit 1
  );

  update public.orders
  set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('shippingCalculation', v_payload)
  where id = p_order_id;

  return v_result || jsonb_build_object('shippingCalculation', v_payload);
end;
$$;

revoke all on function public.issue_rule_based_shipping_quote(text, integer, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.issue_rule_based_shipping_quote(text, integer, text, text, text, jsonb, jsonb, text) to service_role;

-- Preserve JNE rates long enough to survive public-checker outages while the
-- checkout still snapshots the selected amount into each order.
update public.shipping_settings
set jne_rate_cache_ttl_hours = 168,
    jne_rate_max_stale_hours = 2160,
    updated_at = now()
where id = 'default';

update public.jne_tariff_cache
set valid_until = greatest(valid_until, fetched_at + interval '168 hours'),
    updated_at = now()
where status = 'available';

-- Normalize the finance credit to the public catalogue name.
update public.finance_state
set state = jsonb_set(
  jsonb_set(
    state,
    '{inventory}',
    coalesce((
      select jsonb_agg(
        case
          when item ->> 'sku' = 'NXP-2026-CST-0006'
            then jsonb_set(item, '{artistName}', to_jsonb('The Prodigy'::text), true)
          else item
        end
      )
      from jsonb_array_elements(coalesce(state -> 'inventory', '[]'::jsonb)) as item
    ), '[]'::jsonb),
    true
  ),
  '{inventoryStock}',
  coalesce((
    select jsonb_agg(
      case
        when item ->> 'sku' = 'NXP-2026-CST-0006'
          then jsonb_set(item, '{artist}', to_jsonb('The Prodigy'::text), true)
        else item
      end
    )
    from jsonb_array_elements(coalesce(state -> 'inventoryStock', '[]'::jsonb)) as item
  ), '[]'::jsonb),
  true
),
updated_at = now()
where key = 'main';

-- These rows were confirmed sample or delivery tests. A preflight copy is
-- retained in store_backups before this migration is applied.
delete from public.requests
where id in (
  'REQ-030',
  'REQ-031',
  'request-1784310884222-2031o9',
  'request-1784312372716-40hxup',
  'request-1784313184366-mvcv3r',
  'request-1784351937367-xgn4pa',
  'request-1784351988632-wo4vnf',
  'request-1784356012982-a6rpkh',
  'request-1784356414284-675onu',
  'request-1784357173892-rg7kjf'
);

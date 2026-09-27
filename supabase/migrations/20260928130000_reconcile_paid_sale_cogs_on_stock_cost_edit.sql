-- A Finance cost-basis correction must adjust paid-sale accounting without
-- changing the physical quantity that catalog availability reconciles from.
-- Keep this inside the existing optimistic section write transaction so the
-- stock edit and its derived COGS result cannot diverge.
create or replace function public.write_finance_state_sections(
  p_changes jsonb,
  p_expected_revisions jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_section text;
  v_revision bigint;
  v_expected bigint;
  v_state jsonb;
  v_effective_changes jsonb := p_changes;
  v_changed_cost_skus text[] := array[]::text[];
  v_recalculated_orders jsonb := '{}'::jsonb;
  v_recalculated_sales jsonb := '[]'::jsonb;
  v_recalculated_sale_count integer := 0;
  v_allowed text[] := array['general', 'sales', 'expenses', 'inventory', 'inventoryStock', 'monthlyReports', 'openingCash', 'targets'];
begin
  if jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    return;
  end if;

  if exists (select 1 from jsonb_object_keys(p_changes) as candidate(section) where not (section = any(v_allowed))) then
    raise exception 'Invalid finance section.' using errcode = '22023';
  end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[],"monthlyReports":[],"openingCash":null,"targets":{}}'::jsonb)
  on conflict (key) do nothing;

  select state into v_state from public.finance_state where key = 'main' for update;

  -- Check every client-supplied section before any state changes. Derived sales
  -- updates below use this locked, latest state and therefore cannot overwrite
  -- a concurrent manual Daily Sales edit.
  foreach v_section in array v_allowed loop
    continue when not (p_changes ? v_section);
    select revision into v_revision
    from public.finance_state_sections
    where section = v_section
    for update;

    if not found then
      raise exception 'Finance section % is missing.', v_section using errcode = 'P0001';
    end if;

    if p_expected_revisions ? v_section then
      begin
        v_expected := (p_expected_revisions ->> v_section)::bigint;
      exception when invalid_text_representation then
        raise exception 'Invalid finance revision.' using errcode = '22023';
      end;
      if v_expected <> v_revision then
        raise exception 'FINANCE_SECTION_CONFLICT:%', v_section using errcode = 'P0001';
      end if;
    end if;
  end loop;

  foreach v_section in array v_allowed loop
    continue when not (p_changes ? v_section);
    v_state := jsonb_set(v_state, array[v_section], p_changes -> v_section, true);
  end loop;

  if p_changes ? 'inventoryStock' then
    -- Compare the submitted cost basis to the locked prior ledger by SKU. A
    -- quantity-only edit never enters this path, so it cannot touch sales.
    with next_stock as (
      select lower(trim(stock.value ->> 'sku')) as sku_key,
        case
          when coalesce(stock.value ->> 'costBasis', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (stock.value ->> 'costBasis')::numeric
          else 0
        end as cost_basis
      from jsonb_array_elements(
        case when jsonb_typeof(p_changes -> 'inventoryStock') = 'array'
          then p_changes -> 'inventoryStock' else '[]'::jsonb end
      ) as stock(value)
      where nullif(trim(stock.value ->> 'sku'), '') is not null
    ), previous_stock as (
      select lower(trim(stock.value ->> 'sku')) as sku_key,
        case
          when coalesce(stock.value ->> 'costBasis', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (stock.value ->> 'costBasis')::numeric
          else 0
        end as cost_basis
      from jsonb_array_elements(coalesce((select state from public.finance_state where key = 'main') -> 'inventoryStock', '[]'::jsonb)) as stock(value)
      where nullif(trim(stock.value ->> 'sku'), '') is not null
    )
    select coalesce(array_agg(next_stock.sku_key order by next_stock.sku_key), array[]::text[])
    into v_changed_cost_skus
    from next_stock
    left join previous_stock on previous_stock.sku_key = next_stock.sku_key
    where next_stock.cost_basis is distinct from coalesce(previous_stock.cost_basis, 0);
  end if;

  if cardinality(v_changed_cost_skus) > 0 then
    -- Rebuild COGS only for settled customer orders that contain the corrected
    -- SKU. Cost comes from the freshly submitted Finance ledger; quantities
    -- remain solely under the payment/reservation stock lifecycle.
    with affected_orders as (
      select distinct line.order_id
      from public.order_lines as line
      join public.order_records as order_record on order_record.id = line.order_id
      where lower(trim(line.sku)) = any(v_changed_cost_skus)
        and lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed')
        and coalesce(order_record.order_class, 'Customer') <> 'Test'
    ), order_cogs as (
      select affected.order_id,
        coalesce(round(sum(line.quantity * coalesce(costs.unit_cost, 0))), 0)::integer as cogs,
        coalesce(jsonb_agg(distinct line.sku) filter (where coalesce(costs.unit_cost, 0) <= 0), '[]'::jsonb) as missing_cogs_skus
      from affected_orders as affected
      join public.order_lines as line on line.order_id = affected.order_id
      left join lateral (
        select case
          when coalesce(stock.value ->> 'costBasis', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (stock.value ->> 'costBasis')::numeric
          else 0
        end as unit_cost
        from jsonb_array_elements(coalesce(v_state -> 'inventoryStock', '[]'::jsonb)) as stock(value)
        where lower(trim(stock.value ->> 'sku')) = lower(trim(line.sku))
        limit 1
      ) as costs on true
      group by affected.order_id
    )
    select coalesce(jsonb_object_agg(
      order_cogs.order_id,
      jsonb_build_object(
        'cogs', order_cogs.cogs,
        'missingCogsSkus', order_cogs.missing_cogs_skus,
        'cogsStatus', case when jsonb_array_length(order_cogs.missing_cogs_skus) > 0 then 'Missing cost basis' else 'Complete' end
      )
    ), '{}'::jsonb)
    into v_recalculated_orders
    from order_cogs;

    select coalesce(jsonb_agg(
      case when recalculated.data is null then sale.value else
        sale.value || jsonb_build_object(
          'cogs', (recalculated.data ->> 'cogs')::integer,
          'cogsStatus', recalculated.data ->> 'cogsStatus',
          'missingCogsSkus', recalculated.data -> 'missingCogsSkus',
          'grossProfit', (
            case when coalesce(sale.value ->> 'revenue', '') ~ '^-?[0-9]+([.][0-9]+)?$'
              then (sale.value ->> 'revenue')::numeric else 0 end
            - (
              case when coalesce(sale.value ->> 'revenue', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                then (sale.value ->> 'revenue')::numeric else 0 end
              * case when coalesce(sale.value ->> 'discount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                  then (sale.value ->> 'discount')::numeric else 0 end / 100
            )
            - (recalculated.data ->> 'cogs')::numeric
          )
        )
      end
      order by sale.ordinality
    ), '[]'::jsonb), count(*) filter (where recalculated.data is not null)
    into v_recalculated_sales, v_recalculated_sale_count
    from jsonb_array_elements(coalesce(v_state -> 'sales', '[]'::jsonb)) with ordinality as sale(value, ordinality)
    left join lateral (
      select v_recalculated_orders -> regexp_replace(coalesce(sale.value ->> 'id', ''), '^sale-', '') as data
    ) as recalculated on true;

    if v_recalculated_sale_count > 0 then
      v_state := jsonb_set(v_state, '{sales}', v_recalculated_sales, true);
      v_effective_changes := jsonb_set(v_effective_changes, '{sales}', v_recalculated_sales, true);
    end if;

    update public.orders as order_mirror
    set raw = coalesce(order_mirror.raw, '{}'::jsonb) || jsonb_build_object(
      'cogs', (v_recalculated_orders -> order_mirror.id ->> 'cogs')::integer,
      'cogsStatus', v_recalculated_orders -> order_mirror.id ->> 'cogsStatus',
      'missingCogsSkus', v_recalculated_orders -> order_mirror.id -> 'missingCogsSkus',
      'grossProfit', (
        coalesce((order_mirror.raw ->> 'merchandiseTotal')::numeric, 0)
        - coalesce((order_mirror.raw ->> 'discountTotal')::numeric, 0)
        - (v_recalculated_orders -> order_mirror.id ->> 'cogs')::numeric
      )
    ),
    updated_at = now()
    where v_recalculated_orders ? order_mirror.id;
  end if;

  foreach v_section in array v_allowed loop
    continue when not (v_effective_changes ? v_section);
    update public.finance_state_sections
    set payload = v_effective_changes -> v_section,
        revision = revision + 1,
        updated_at = now()
    where section = v_section;
  end loop;

  perform set_config('nixp.finance_sections_write', 'on', true);
  update public.finance_state set state = v_state, updated_at = now() where key = 'main';
end;
$$;

revoke all on function public.write_finance_state_sections(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_finance_state_sections(jsonb, jsonb) to service_role;

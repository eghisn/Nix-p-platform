create or replace function public.annotate_legacy_order_delivery_cogs(
  p_order_id text,
  p_shipping_address jsonb,
  p_shipping_method text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order jsonb;
  v_state jsonb;
  v_sales jsonb;
  v_cogs integer := 0;
  v_missing_cogs jsonb := '[]'::jsonb;
  v_shipping_status text;
begin
  if trim(coalesce(p_shipping_method, '')) not in ('JNE', 'GoSend Manual', 'Store Pickup') then
    raise exception 'INVALID_SHIPPING_METHOD';
  end if;
  v_shipping_status := case trim(p_shipping_method) when 'JNE' then 'Awaiting Selection' when 'GoSend Manual' then 'Awaiting Quote' else 'Not Required' end;

  select raw into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select state into v_state from public.finance_state where key = 'main' for update;

  select coalesce(round(sum((line->>'quantity')::integer * coalesce(costs.unit_cost, 0))), 0)::integer,
    coalesce(jsonb_agg(distinct line->>'sku') filter (where coalesce(costs.unit_cost, 0) <= 0), '[]'::jsonb)
  into v_cogs, v_missing_cogs
  from jsonb_array_elements(coalesce(v_order->'lineItems', '[]'::jsonb)) line
  left join lateral (
    select case when coalesce(stock->>'costBasis', '') ~ '^[0-9]+([.][0-9]+)?$' then (stock->>'costBasis')::numeric else 0 end as unit_cost
    from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) stock
    where lower(trim(stock->>'sku')) = lower(trim(line->>'sku'))
    limit 1
  ) costs on true;

  v_order := v_order || jsonb_build_object(
    'shippingMethod', trim(p_shipping_method),
    'shippingStatus', v_shipping_status,
    'shippingAddress', coalesce(p_shipping_address, '{}'::jsonb),
    'cogs', v_cogs,
    'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end,
    'missingCogsSkus', v_missing_cogs
  );
  update public.orders set raw = v_order where id = p_order_id;

  select coalesce(jsonb_agg(
    case when sale->>'id' = 'sale-' || p_order_id then
      sale || jsonb_build_object(
        'cogs', v_cogs,
        'grossProfit', coalesce((sale->>'revenue')::numeric, 0) - coalesce((sale->>'discount')::numeric, 0) - v_cogs,
        'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end,
        'missingCogsSkus', v_missing_cogs
      )
    else sale end
  ), '[]'::jsonb) into v_sales
  from jsonb_array_elements(coalesce(v_state->'sales', '[]'::jsonb)) sale;

  v_state := jsonb_set(coalesce(v_state, '{}'::jsonb), '{sales}', v_sales, true);
  update public.finance_state set state = v_state, updated_at = now() where key = 'main';
  return v_order;
end;
$$;

revoke all on function public.annotate_legacy_order_delivery_cogs(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.annotate_legacy_order_delivery_cogs(text, jsonb, text) to service_role;

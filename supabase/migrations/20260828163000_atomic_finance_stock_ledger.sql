-- Finance owns the physical stock count. Products expose only the computed
-- availability: Finance quantity minus active checkout reservations.
create or replace function public.finance_inventory_quantity(p_state jsonb, p_sku text)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(stock.value->>'qty', '') ~ '^-?[0-9]+$' then greatest(0, (stock.value->>'qty')::integer)
    else 0
  end
  from jsonb_array_elements(coalesce(p_state->'inventoryStock', '[]'::jsonb)) with ordinality as stock(value, ordinality)
  where lower(trim(stock.value->>'sku')) = lower(trim(p_sku))
  order by stock.ordinality desc
  limit 1;
$$;

create or replace function public.reconcile_finance_stock_to_catalog(p_skus text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_product record;
  v_reserved integer;
  v_available integer;
  v_sold integer;
  v_reconciled integer := 0;
  v_missing_catalog integer := 0;
begin
  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
  -- Every writer that can affect sellable stock takes this lock first.
  select state into v_state from public.finance_state where key = 'main' for update;

  with finance_stock as (
    select distinct on (lower(trim(stock.value->>'sku')))
      lower(trim(stock.value->>'sku')) as sku_key
    from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) with ordinality as stock(value, ordinality)
    where nullif(trim(stock.value->>'sku'), '') is not null
      and (p_skus is null or cardinality(p_skus) = 0 or lower(trim(stock.value->>'sku')) = any(array(select lower(trim(value)) from unnest(p_skus) value)))
    order by lower(trim(stock.value->>'sku')), stock.ordinality desc
  )
  select count(*) into v_missing_catalog
  from finance_stock stock
  left join public.products product on lower(trim(product.sku)) = stock.sku_key
  where product.id is null;

  for v_product in
    with finance_stock as (
      select distinct on (lower(trim(stock.value->>'sku')))
        lower(trim(stock.value->>'sku')) as sku_key,
        case when coalesce(stock.value->>'qty', '') ~ '^-?[0-9]+$' then greatest(0, (stock.value->>'qty')::integer) else 0 end as finance_qty
      from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) with ordinality as stock(value, ordinality)
      where nullif(trim(stock.value->>'sku'), '') is not null
        and (p_skus is null or cardinality(p_skus) = 0 or lower(trim(stock.value->>'sku')) = any(array(select lower(trim(value)) from unnest(p_skus) value)))
      order by lower(trim(stock.value->>'sku')), stock.ordinality desc
    )
    select product.id, product.sku, product.raw, stock.finance_qty
    from public.products product
    join finance_stock stock on lower(trim(product.sku)) = stock.sku_key
    order by product.id
    for update of product
  loop
    select coalesce(sum(quantity), 0)::integer into v_reserved
    from public.inventory_reservations
    where product_id = v_product.id and status = 'Active';
    v_available := greatest(0, v_product.finance_qty - v_reserved);
    v_sold := case
      when coalesce(v_product.raw->'stock'->>'sold', '') ~ '^-?[0-9]+$' then greatest(0, (v_product.raw->'stock'->>'sold')::integer)
      else 0
    end;
    update public.products set
      qty = v_available,
      raw = jsonb_set(
        jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_available), true),
        '{stock}', jsonb_build_object('available', v_available, 'reserved', v_reserved, 'sold', v_sold), true
      ),
      updated_at = now()
    where id = v_product.id;
    v_reconciled := v_reconciled + 1;
  end loop;

  return jsonb_build_object('reconciled', v_reconciled, 'missingCatalogProducts', v_missing_catalog);
end;
$$;

revoke all on function public.finance_inventory_quantity(jsonb, text) from public, anon, authenticated;
revoke all on function public.reconcile_finance_stock_to_catalog(text[]) from public, anon, authenticated;
grant execute on function public.reconcile_finance_stock_to_catalog(text[]) to service_role;

create or replace function public.apply_verified_payment(
  p_order_id text,
  p_provider text,
  p_provider_transaction_id text,
  p_provider_order_id text,
  p_amount integer,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.order_records%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_product public.products%rowtype;
  v_state jsonb;
  v_next_inventory_stock jsonb;
  v_sale jsonb;
  v_cogs integer := 0;
  v_missing_cogs jsonb := '[]'::jsonb;
  v_missing_inventory jsonb := '[]'::jsonb;
  v_shipping_status text;
begin
  select * into v_order from public.order_records where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'Paid' then return jsonb_build_object('id', v_order.id, 'paymentStatus', 'Paid', 'idempotent', true); end if;
  if v_order.payment_status not in ('Pending', 'Unpaid') then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if v_order.payment_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;
  if p_amount <> v_order.grand_total then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
  -- Lock Finance before products, matching reconciliation and release.
  select state into v_state from public.finance_state where key = 'main' for update;

  with ordered as (
    select lower(trim(sku)) as sku_key, sum(quantity)::integer as quantity
    from public.order_lines where order_id = p_order_id group by lower(trim(sku))
  )
  select coalesce(jsonb_agg(
    case when ordered.quantity is null then stock.value
      else jsonb_set(stock.value, '{qty}', to_jsonb(greatest(0, case when coalesce(stock.value->>'qty', '') ~ '^-?[0-9]+$' then (stock.value->>'qty')::integer else 0 end - ordered.quantity)), true)
    end order by stock.ordinality
  ), '[]'::jsonb) into v_next_inventory_stock
  from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) with ordinality as stock(value, ordinality)
  left join ordered on lower(trim(stock.value->>'sku')) = ordered.sku_key;

  with ordered as (
    select lower(trim(sku)) as sku_key from public.order_lines where order_id = p_order_id group by lower(trim(sku))
  )
  select coalesce(jsonb_agg(ordered.sku_key), '[]'::jsonb) into v_missing_inventory
  from ordered
  where not exists (
    select 1 from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) stock
    where lower(trim(stock->>'sku')) = ordered.sku_key
  );

  for v_reservation in
    select * from public.inventory_reservations
    where order_id = p_order_id and status = 'Active'
    order by product_id, coalesce(size_label, ''), id
    for update
  loop
    select * into v_product from public.products where id = v_reservation.product_id for update;
    if found then
      update public.products set
        raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{stock}', jsonb_build_object(
          'available', qty,
          'reserved', greatest(0, case when coalesce(raw->'stock'->>'reserved', '') ~ '^-?[0-9]+$' then (raw->'stock'->>'reserved')::integer else 0 end - v_reservation.quantity),
          'sold', case when coalesce(raw->'stock'->>'sold', '') ~ '^-?[0-9]+$' then (raw->'stock'->>'sold')::integer else 0 end + v_reservation.quantity
        ), true), updated_at = now()
      where id = v_product.id;
    end if;
    update public.inventory_reservations set status = 'Converted', updated_at = now() where id = v_reservation.id;
  end loop;

  select coalesce(round(sum(lines.quantity * coalesce(costs.unit_cost, 0))), 0)::integer,
    coalesce(jsonb_agg(distinct lines.sku) filter (where coalesce(costs.unit_cost, 0) <= 0), '[]'::jsonb)
  into v_cogs, v_missing_cogs
  from public.order_lines lines
  left join lateral (
    select case when coalesce(stock->>'costBasis', '') ~ '^[0-9]+([.][0-9]+)?$' then (stock->>'costBasis')::numeric else 0 end as unit_cost
    from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) stock
    where lower(trim(stock->>'sku')) = lower(trim(lines.sku)) limit 1
  ) costs on true
  where lines.order_id = p_order_id;

  v_sale := jsonb_build_object(
    'id', 'sale-' || p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
    'invoice', p_order_id, 'category', 'Retail',
    'sku', (select string_agg(case when coalesce(size_label, '') <> '' then sku || '/' || size_label else sku end, ', ') from public.order_lines where order_id = p_order_id),
    'qty', (select coalesce(sum(quantity), 0) from public.order_lines where order_id = p_order_id),
    'revenue', v_order.merchandise_total, 'shippingCollected', v_order.shipping_total,
    'totalCollected', v_order.grand_total, 'discount', v_order.discount_total, 'discountContext', '',
    'cogs', v_cogs, 'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end,
    'missingCogsSkus', v_missing_cogs, 'grossProfit', v_order.merchandise_total - v_order.discount_total - v_cogs,
    'paymentMethod', p_provider
  );
  v_state := jsonb_set(coalesce(v_state, '{}'::jsonb), '{inventoryStock}', v_next_inventory_stock, true);
  v_state := jsonb_set(v_state, '{sales}', coalesce(v_state->'sales', '[]'::jsonb) || jsonb_build_array(v_sale), true);
  update public.finance_state set state = v_state, updated_at = now() where key = 'main';

  v_shipping_status := case when v_order.shipping_method in ('JNE', 'GoSend Manual') then 'Awaiting Pickup' else 'Not Required' end;
  update public.order_records set order_status = 'Active', payment_status = 'Paid', fulfillment_status = 'Processing', shipping_status = v_shipping_status, paid_at = now(), updated_at = now() where id = p_order_id;
  update public.orders set status = 'Paid', raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('status', 'Paid', 'orderStatus', 'Active', 'paymentStatus', 'Paid', 'fulfillmentStatus', 'Processing', 'shippingStatus', v_shipping_status, 'paidAt', now(), 'cogs', v_cogs, 'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end, 'merchandiseTotal', v_order.merchandise_total, 'shippingTotal', v_order.shipping_total, 'total', v_order.grand_total) where id = p_order_id;
  update public.payment_attempts set provider_transaction_id = nullif(p_provider_transaction_id, ''), status = 'Paid', amount = p_amount, payload = coalesce(p_payload, '{}'::jsonb), updated_at = now() where provider = p_provider and provider_order_id = nullif(p_provider_order_id, '');
  if not found then insert into public.payment_attempts (order_id, provider, provider_transaction_id, provider_order_id, status, amount, payload) values (p_order_id, p_provider, nullif(p_provider_transaction_id, ''), nullif(p_provider_order_id, ''), 'Paid', p_amount, coalesce(p_payload, '{}'::jsonb)); end if;
  perform public.nixp_order_event(p_order_id, 'payment_paid', 'Payment Provider', 'Verified payment received; order moved to processing.', jsonb_build_object('provider', p_provider, 'transactionId', p_provider_transaction_id, 'cogs', v_cogs, 'missingCogsSkus', v_missing_cogs, 'missingFinanceStockSkus', v_missing_inventory));
  return jsonb_build_object('id', p_order_id, 'orderStatus', 'Active', 'paymentStatus', 'Paid', 'fulfillmentStatus', 'Processing', 'shippingStatus', v_shipping_status, 'cogs', v_cogs, 'missingCogsSkus', v_missing_cogs, 'missingFinanceStockSkus', v_missing_inventory);
end;
$$;

create or replace function public.release_order_reservations(
  p_order_id text, p_order_status text, p_payment_status text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.order_records%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_product public.products%rowtype;
  v_state jsonb;
  v_sizes jsonb;
  v_finance_qty integer;
  v_reserved integer;
  v_available integer;
  v_sold integer;
begin
  if p_order_status not in ('Cancelled', 'Expired') then raise exception 'INVALID_RELEASE_STATUS'; end if;
  if p_payment_status not in ('Unpaid', 'Failed', 'Expired') then raise exception 'INVALID_RELEASE_PAYMENT_STATUS'; end if;
  select * into v_order from public.order_records where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'Paid' then raise exception 'PAID_ORDER_REQUIRES_REFUND_WORKFLOW'; end if;
  insert into public.finance_state (key, state) values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb) on conflict (key) do nothing;
  select state into v_state from public.finance_state where key = 'main' for update;
  for v_reservation in
    select * from public.inventory_reservations where order_id = p_order_id and status = 'Active'
    order by product_id, coalesce(size_label, ''), id for update
  loop
    select * into v_product from public.products where id = v_reservation.product_id for update;
    update public.inventory_reservations set status = 'Released', released_at = now(), updated_at = now() where id = v_reservation.id;
    if found then
      v_sizes := v_product.sizes;
      if v_reservation.size_label is not null and jsonb_typeof(v_product.sizes) = 'array' then
        select coalesce(jsonb_agg(case when value->>'label' = v_reservation.size_label then jsonb_set(jsonb_set(value, '{quantity}', to_jsonb(coalesce(nullif(value->>'quantity', '')::integer, 0) + v_reservation.quantity), true), '{soldOut}', 'false'::jsonb, true) else value end), '[]'::jsonb) into v_sizes from jsonb_array_elements(v_product.sizes) size_item(value);
      end if;
      v_finance_qty := public.finance_inventory_quantity(v_state, v_product.sku);
      select coalesce(sum(quantity), 0)::integer into v_reserved from public.inventory_reservations where product_id = v_product.id and status = 'Active';
      v_available := greatest(0, coalesce(v_finance_qty, coalesce(v_product.qty, 0) + v_reservation.quantity) - v_reserved);
      v_sold := case when coalesce(v_product.raw->'stock'->>'sold', '') ~ '^-?[0-9]+$' then greatest(0, (v_product.raw->'stock'->>'sold')::integer) else 0 end;
      update public.products set sizes = v_sizes, qty = v_available, raw = jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_available), true), '{stock}', jsonb_build_object('available', v_available, 'reserved', v_reserved, 'sold', v_sold), true), updated_at = now() where id = v_product.id;
    end if;
  end loop;
  update public.order_records set order_status = p_order_status, payment_status = p_payment_status, fulfillment_status = 'Unfulfilled', updated_at = now(), cancelled_at = case when p_order_status = 'Cancelled' then now() else cancelled_at end where id = p_order_id;
  update public.orders set status = p_order_status, raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('status', p_order_status, 'orderStatus', p_order_status, 'paymentStatus', p_payment_status, 'fulfillmentStatus', 'Unfulfilled') where id = p_order_id;
  perform public.nixp_order_event(p_order_id, lower(replace(p_order_status, ' ', '_')), 'System', p_reason);
  return jsonb_build_object('id', p_order_id, 'orderStatus', p_order_status, 'paymentStatus', p_payment_status);
end;
$$;

revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.release_order_reservations(text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;
grant execute on function public.release_order_reservations(text, text, text, text) to service_role;

-- Never release an order while a payment session may still settle. The
-- Midtrans webhook or verified provider reconciliation releases terminal
-- failures and converts successful reservations instead.
create or replace function public.release_expired_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_count integer := 0;
  v_provider_held integer := 0;
begin
  for v_order in
    select id from public.order_records
    where payment_status = 'Pending'
      and payment_expires_at <= now() - interval '5 minutes'
    order by payment_expires_at, id
    for update skip locked
  loop
    -- Check after locking the order so a concurrent payment-session claim
    -- cannot slip between this test and the stock release.
    if exists (
      select 1 from public.payment_attempts
      where order_id = v_order.id
    ) then
      v_provider_held := v_provider_held + 1;
      continue;
    end if;

    perform public.release_order_reservations(
      v_order.id,
      'Expired',
      'Expired',
      'The one-hour payment window and provider callback grace period ended; reserved stock released.'
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expired', v_count, 'providerHeld', v_provider_held);
end;
$$;

-- A verified settlement can arrive after the customer-facing deadline.
-- Finance and stock stay atomic, but payment still requires the active order
-- and its reservation; an already-released order cannot be silently revived.
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
  if v_order.order_status <> 'Active' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if not exists (
    select 1 from public.inventory_reservations
    where order_id = p_order_id and status = 'Active'
  ) then raise exception 'RESERVATION_NOT_ACTIVE'; end if;
  if p_amount <> v_order.grand_total then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
  select state into v_state from public.finance_state where key = 'main' for update;

  with ordered_by_sku as (
    select lower(trim(sku)) as sku_key, sum(quantity)::integer as quantity
    from public.order_lines where order_id = p_order_id group by lower(trim(sku))
  ), ordered_by_size as (
    select lower(trim(sku)) as sku_key, nullif(trim(size_label), '') as size_label, sum(quantity)::integer as quantity
    from public.order_lines
    where order_id = p_order_id and nullif(trim(size_label), '') is not null
    group by lower(trim(sku)), nullif(trim(size_label), '')
  )
  select coalesce(jsonb_agg(
    case when ordered_by_sku.quantity is null then stock.value else
      jsonb_set(
        jsonb_set(stock.value, '{qty}', to_jsonb(greatest(0, case when coalesce(stock.value->>'qty', '') ~ '^-?[0-9]+$' then (stock.value->>'qty')::integer else 0 end - ordered_by_sku.quantity)), true),
        '{sizes}',
        case when jsonb_typeof(stock.value->'sizes') = 'array' then coalesce((
          select jsonb_agg(
            case when ordered_by_size.quantity is null then size_item.value else
              jsonb_set(
                jsonb_set(size_item.value, '{quantity}', to_jsonb(greatest(0, case when coalesce(size_item.value->>'quantity', '') ~ '^-?[0-9]+$' then (size_item.value->>'quantity')::integer else 0 end - ordered_by_size.quantity)), true),
                '{soldOut}', to_jsonb(greatest(0, case when coalesce(size_item.value->>'quantity', '') ~ '^-?[0-9]+$' then (size_item.value->>'quantity')::integer else 0 end - ordered_by_size.quantity) <= 0), true
              )
            end order by size_item.ordinality
          )
          from jsonb_array_elements(stock.value->'sizes') with ordinality as size_item(value, ordinality)
          left join ordered_by_size
            on ordered_by_size.sku_key = lower(trim(stock.value->>'sku'))
            and ordered_by_size.size_label = size_item.value->>'label'
        ), '[]'::jsonb) else coalesce(stock.value->'sizes', '[]'::jsonb) end,
        true
      )
    end order by stock.ordinality
  ), '[]'::jsonb) into v_next_inventory_stock
  from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) with ordinality as stock(value, ordinality)
  left join ordered_by_sku on lower(trim(stock.value->>'sku')) = ordered_by_sku.sku_key;

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

-- Only live, still-payable orders belong in provider reconciliation. Historic
-- attempts must not crowd urgent reservations out of the scheduled batch.
create or replace function public.pending_midtrans_attempts(p_limit integer default 50)
returns table(order_id text, status text, payload jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select attempt.order_id, attempt.status, attempt.payload, attempt.updated_at
  from public.payment_attempts attempt
  join public.order_records order_record on order_record.id = attempt.order_id
  where attempt.provider = 'Midtrans'
    and attempt.status in ('Creating', 'Creation Failed', 'Pending', 'Provider Pending')
    and attempt.updated_at <= now() - interval '30 seconds'
    and order_record.order_status = 'Active'
    and order_record.payment_status = 'Pending'
  order by order_record.payment_expires_at, attempt.updated_at
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.release_expired_orders() from public, anon, authenticated;
revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.pending_midtrans_attempts(integer) from public, anon, authenticated;
grant execute on function public.release_expired_orders() to service_role;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;
grant execute on function public.pending_midtrans_attempts(integer) to service_role;

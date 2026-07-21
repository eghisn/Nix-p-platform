-- Cover operational foreign keys before order volume grows. These make parent
-- deletes and per-order/product lookups avoid sequential scans.
create index if not exists order_lines_product_id_idx on public.order_lines (product_id);
create index if not exists payment_attempts_order_id_idx on public.payment_attempts (order_id);
create index if not exists return_requests_order_id_idx on public.return_requests (order_id);
create index if not exists shipping_quotes_order_id_idx on public.shipping_quotes (order_id);

create or replace function public.create_checkout_order(
  p_order_id text,
  p_customer jsonb,
  p_items jsonb,
  p_shipping_address jsonb default '{}'::jsonb,
  p_shipping_method text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.order_records%rowtype;
  v_product public.products%rowtype;
  v_request record;
  v_size jsonb;
  v_sizes jsonb;
  v_stock_total integer;
  v_next_quantity integer;
  v_total integer := 0;
  v_line_items jsonb := '[]'::jsonb;
  v_expiry timestamptz := now() + interval '2 hours';
  v_shipping_method text := trim(coalesce(p_shipping_method, ''));
  v_shipping_status text;
  v_customer jsonb := jsonb_build_object(
    'name', left(trim(coalesce(p_customer->>'name', '')), 160),
    'email', left(trim(coalesce(p_customer->>'email', '')), 254),
    'whatsapp', left(trim(coalesce(p_customer->>'whatsapp', '')), 48),
    'notes', left(trim(coalesce(p_customer->>'notes', '')), 2000)
  );
begin
  if p_order_id !~ '^order-[A-Za-z0-9_-]{8,96}$' then raise exception 'INVALID_ORDER_ID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'CART_EMPTY'; end if;
  if v_shipping_method not in ('JNE', 'GoSend Manual', 'Store Pickup') then raise exception 'INVALID_SHIPPING_METHOD'; end if;
  v_shipping_status := case v_shipping_method when 'JNE' then 'Awaiting Selection' when 'GoSend Manual' then 'Awaiting Quote' else 'Not Required' end;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id, 0));
  select * into v_existing from public.order_records where id = p_order_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.order_status, 'paymentStatus', v_existing.payment_status,
      'fulfillmentStatus', v_existing.fulfillment_status, 'shippingStatus', v_existing.shipping_status,
      'shippingMethod', v_existing.shipping_method, 'total', v_existing.grand_total,
      'paymentExpiresAt', v_existing.payment_expires_at
    );
  end if;

  for v_request in
    select item_id, item_size, sum(quantity)::integer as quantity
    from (
      select nullif(trim(value->>'id'), '') as item_id,
        nullif(trim(value->>'size'), '') as item_size,
        least(20, greatest(1, case when coalesce(value->>'quantity', '') ~ '^[0-9]+$' then (value->>'quantity')::integer else 1 end)) as quantity
      from jsonb_array_elements(p_items) as item(value)
    ) requested
    where item_id is not null
    group by item_id, item_size
    order by item_id, item_size nulls first
  loop
    select * into v_product from public.products where id = v_request.item_id for update;
    if not found or v_product.publish_status <> 'Published' or v_product.visibility <> 'Public' then
      raise exception 'ITEM_UNAVAILABLE: %', v_request.item_id;
    end if;

    if jsonb_typeof(v_product.sizes) = 'array' and jsonb_array_length(v_product.sizes) > 0 then
      if v_request.item_size is null then raise exception 'SIZE_REQUIRED: %', v_product.title; end if;
      select value into v_size from jsonb_array_elements(v_product.sizes) size_item(value)
      where size_item.value->>'label' = v_request.item_size limit 1;
      if v_size is null then raise exception 'SIZE_UNAVAILABLE: %', v_product.title; end if;
      v_next_quantity := coalesce(nullif(v_size->>'quantity', '')::integer, 0) - v_request.quantity;
      if v_next_quantity < 0 then raise exception 'OUT_OF_STOCK: % / %', v_product.title, v_request.item_size; end if;
      select coalesce(jsonb_agg(case when value->>'label' = v_request.item_size then
        jsonb_set(jsonb_set(value, '{quantity}', to_jsonb(v_next_quantity), true), '{soldOut}', to_jsonb(v_next_quantity <= 0), true)
        else value end), '[]'::jsonb) into v_sizes
      from jsonb_array_elements(v_product.sizes) size_item(value);
      select coalesce(sum(coalesce(nullif(value->>'quantity', '')::integer, 0)), 0)::integer into v_stock_total
      from jsonb_array_elements(v_sizes) size_item(value);
      update public.products set sizes = v_sizes, qty = v_stock_total,
        raw = jsonb_set(jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{sizes}', v_sizes, true), '{qty}', to_jsonb(v_stock_total), true),
          '{stock}', jsonb_build_object('available', v_stock_total, 'reserved', coalesce((raw->'stock'->>'reserved')::integer, 0) + v_request.quantity, 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)), true),
        updated_at = now() where id = v_product.id;
    else
      v_next_quantity := coalesce(v_product.qty, 0) - v_request.quantity;
      if v_next_quantity < 0 then raise exception 'OUT_OF_STOCK: %', v_product.title; end if;
      v_stock_total := v_next_quantity;
      update public.products set qty = v_next_quantity,
        raw = jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_next_quantity), true),
          '{stock}', jsonb_build_object('available', v_next_quantity, 'reserved', coalesce((raw->'stock'->>'reserved')::integer, 0) + v_request.quantity, 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)), true),
        updated_at = now() where id = v_product.id;
    end if;

    insert into public.inventory_reservations (order_id, product_id, size_label, quantity, expires_at)
    values (p_order_id, v_product.id, v_request.item_size, v_request.quantity, v_expiry);
    v_total := v_total + (v_product.price * v_request.quantity);
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id, 'sku', v_product.sku, 'artist', v_product.artist, 'title', v_product.title,
      'size', coalesce(v_request.item_size, ''), 'quantity', v_request.quantity,
      'unitPrice', v_product.price, 'lineTotal', v_product.price * v_request.quantity
    ));
    insert into public.order_lines (order_id, product_id, sku, artist, title, size_label, quantity, unit_price, line_total)
    values (p_order_id, v_product.id, coalesce(v_product.sku, v_product.id), v_product.artist, v_product.title, v_request.item_size, v_request.quantity, v_product.price, v_product.price * v_request.quantity);
  end loop;

  if jsonb_array_length(v_line_items) = 0 then raise exception 'CART_EMPTY'; end if;
  insert into public.order_records (
    id, public_reference, customer, merchandise_total, grand_total, order_status, payment_status,
    fulfillment_status, shipping_status, shipping_method, shipping_address, payment_expires_at, metadata
  ) values (
    p_order_id, upper(replace(p_order_id, 'order-', 'NXP-')), v_customer, v_total, v_total,
    'Active', 'Pending', 'Stock Reserved', v_shipping_status,
    v_shipping_method, coalesce(p_shipping_address, '{}'::jsonb), v_expiry,
    jsonb_build_object('lineItems', v_line_items, 'priceSource', 'server:postgres.create_checkout_order')
  );
  perform public.nixp_order_event(p_order_id, 'order_created', 'Customer', 'Stock reserved for two hours while payment is pending.', jsonb_build_object('expiresAt', v_expiry, 'shippingMethod', v_shipping_method));

  insert into public.orders (id, name, title, status, sort, raw) values (
    p_order_id, v_customer->>'name', 'Website order', 'Active', 0,
    jsonb_build_object('id', p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      'customer', coalesce(nullif(v_customer->>'name', ''), nullif(v_customer->>'email', ''), 'Website customer'),
      'email', v_customer->>'email', 'whatsapp', v_customer->>'whatsapp', 'channel', 'Website', 'status', 'Active',
      'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
      'shippingStatus', v_shipping_status, 'shippingMethod', v_shipping_method, 'shippingAddress', coalesce(p_shipping_address, '{}'::jsonb),
      'total', v_total, 'items', (select coalesce(jsonb_agg(value->>'productId'), '[]'::jsonb) from jsonb_array_elements(v_line_items)),
      'lineItems', v_line_items, 'notes', v_customer->>'notes', 'priceSource', 'server:postgres.create_checkout_order',
      'paymentExpiresAt', v_expiry, 'createdAt', now())
  );
  return jsonb_build_object('id', p_order_id, 'status', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved', 'shippingStatus', v_shipping_status, 'shippingMethod', v_shipping_method, 'total', v_total, 'items', v_line_items, 'paymentExpiresAt', v_expiry);
end;
$$;

revoke all on function public.create_checkout_order(text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_checkout_order(text, jsonb, jsonb, jsonb, text) to service_role;

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
  v_sale jsonb;
  v_cogs integer := 0;
  v_missing_cogs jsonb := '[]'::jsonb;
begin
  select * into v_order from public.order_records where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'Paid' then return jsonb_build_object('id', v_order.id, 'paymentStatus', 'Paid', 'idempotent', true); end if;
  if v_order.payment_status not in ('Pending', 'Unpaid') then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if v_order.payment_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;
  if p_amount <> v_order.grand_total then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;

  for v_reservation in select * from public.inventory_reservations where order_id=p_order_id and status='Active' for update loop
    select * into v_product from public.products where id=v_reservation.product_id for update;
    if found then
      update public.products set raw=jsonb_set(coalesce(raw, '{}'::jsonb), '{stock}', jsonb_build_object('available', qty, 'reserved', greatest(0, coalesce((raw->'stock'->>'reserved')::integer, 0)-v_reservation.quantity), 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)+v_reservation.quantity), true), updated_at=now() where id=v_product.id;
    end if;
    update public.inventory_reservations set status='Converted', updated_at=now() where id=v_reservation.id;
  end loop;

  insert into public.finance_state (key, state) values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb) on conflict (key) do nothing;
  select state into v_state from public.finance_state where key='main' for update;

  select coalesce(round(sum(lines.quantity * coalesce(costs.unit_cost, 0))), 0)::integer,
    coalesce(jsonb_agg(distinct lines.sku) filter (where coalesce(costs.unit_cost, 0) <= 0), '[]'::jsonb)
  into v_cogs, v_missing_cogs
  from public.order_lines lines
  left join lateral (
    select case when coalesce(stock->>'costBasis', '') ~ '^[0-9]+([.][0-9]+)?$' then (stock->>'costBasis')::numeric else 0 end as unit_cost
    from jsonb_array_elements(coalesce(v_state->'inventoryStock', '[]'::jsonb)) stock
    where lower(trim(stock->>'sku')) = lower(trim(lines.sku))
    limit 1
  ) costs on true
  where lines.order_id=p_order_id;

  v_sale := jsonb_build_object(
    'id', 'sale-' || p_order_id,
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
    'invoice', p_order_id,
    'category', 'Retail',
    'sku', (select string_agg(case when coalesce(size_label,'') <> '' then sku || '/' || size_label else sku end, ', ') from public.order_lines where order_id=p_order_id),
    'qty', (select coalesce(sum(quantity),0) from public.order_lines where order_id=p_order_id),
    'revenue', v_order.grand_total,
    'discount', v_order.discount_total,
    'discountContext', '',
    'cogs', v_cogs,
    'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end,
    'missingCogsSkus', v_missing_cogs,
    'grossProfit', v_order.grand_total-v_order.discount_total-v_cogs,
    'paymentMethod', p_provider
  );
  v_state := jsonb_set(coalesce(v_state, '{}'::jsonb), '{sales}', coalesce(v_state->'sales','[]'::jsonb) || jsonb_build_array(v_sale), true);
  update public.finance_state set state=v_state, updated_at=now() where key='main';
  update public.order_records set order_status='Active', payment_status='Paid', fulfillment_status='Processing', paid_at=now(), updated_at=now() where id=p_order_id;
  update public.orders set status='Paid', raw=coalesce(raw, '{}'::jsonb) || jsonb_build_object('status','Paid','orderStatus','Active','paymentStatus','Paid','fulfillmentStatus','Processing','paidAt',now(),'cogs',v_cogs,'cogsStatus',case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end) where id=p_order_id;
  update public.payment_attempts set provider_transaction_id=nullif(p_provider_transaction_id,''), status='Paid', amount=p_amount, payload=coalesce(p_payload,'{}'::jsonb), updated_at=now() where provider=p_provider and provider_order_id=nullif(p_provider_order_id,'');
  if not found then
    insert into public.payment_attempts (order_id, provider, provider_transaction_id, provider_order_id, status, amount, payload)
    values (p_order_id, p_provider, nullif(p_provider_transaction_id,''), nullif(p_provider_order_id,''), 'Paid', p_amount, coalesce(p_payload,'{}'::jsonb));
  end if;
  perform public.nixp_order_event(p_order_id, 'payment_paid', 'Payment Provider', 'Verified payment received; order moved to processing.', jsonb_build_object('provider',p_provider,'transactionId',p_provider_transaction_id,'cogs',v_cogs,'missingCogsSkus',v_missing_cogs));
  return jsonb_build_object('id',p_order_id,'orderStatus','Active','paymentStatus','Paid','fulfillmentStatus','Processing','cogs',v_cogs,'missingCogsSkus',v_missing_cogs);
end;
$$;

revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;

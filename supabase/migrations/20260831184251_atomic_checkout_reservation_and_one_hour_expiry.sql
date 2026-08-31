-- Reserve sellable stock against the Finance ledger in the same transaction
-- that creates the order. The one-hour customer deadline has a five-minute
-- provider callback grace period; customers cannot initiate payment after the
-- hour, but a verified on-time payment is not lost to webhook latency.

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
  v_state jsonb;
  v_finance_quantity integer;
  v_physical_quantity integer;
  v_reserved_before integer;
  v_reserved_after integer;
  v_available_before integer;
  v_available_after integer;
  v_next_size_quantity integer;
  v_sold integer;
  v_total integer := 0;
  v_line_items jsonb := '[]'::jsonb;
  v_expiry timestamptz := now() + interval '1 hour';
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

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
  -- Payment, release, reconciliation, and checkout all take this lock before a
  -- product lock. That stable order prevents both overselling and deadlocks.
  select state into v_state from public.finance_state where key = 'main' for update;

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

    select coalesce(sum(quantity), 0)::integer into v_reserved_before
    from public.inventory_reservations
    where product_id = v_product.id and status = 'Active';
    v_finance_quantity := public.finance_inventory_quantity(v_state, v_product.sku);
    -- Legacy products without a Finance row retain their current quantity
    -- behavior, while every Finance-backed SKU uses Finance as physical truth.
    v_physical_quantity := coalesce(v_finance_quantity, coalesce(v_product.qty, 0) + v_reserved_before);
    v_available_before := greatest(0, v_physical_quantity - v_reserved_before);
    if v_request.quantity > v_available_before then raise exception 'OUT_OF_STOCK: %', v_product.title; end if;

    if jsonb_typeof(v_product.sizes) = 'array' and jsonb_array_length(v_product.sizes) > 0 then
      if v_request.item_size is null then raise exception 'SIZE_REQUIRED: %', v_product.title; end if;
      select value into v_size from jsonb_array_elements(v_product.sizes) size_item(value)
      where size_item.value->>'label' = v_request.item_size limit 1;
      if v_size is null then raise exception 'SIZE_UNAVAILABLE: %', v_product.title; end if;
      v_next_size_quantity := coalesce(nullif(v_size->>'quantity', '')::integer, 0) - v_request.quantity;
      if v_next_size_quantity < 0 then raise exception 'OUT_OF_STOCK: % / %', v_product.title, v_request.item_size; end if;
      select coalesce(jsonb_agg(
        case when value->>'label' = v_request.item_size then
          jsonb_set(jsonb_set(value, '{quantity}', to_jsonb(v_next_size_quantity), true), '{soldOut}', to_jsonb(v_next_size_quantity <= 0), true)
        else value end order by ordinality
      ), '[]'::jsonb) into v_sizes
      from jsonb_array_elements(v_product.sizes) with ordinality size_item(value, ordinality);
    else
      if v_request.item_size is not null then raise exception 'SIZE_UNAVAILABLE: %', v_product.title; end if;
      v_sizes := v_product.sizes;
    end if;

    insert into public.inventory_reservations (order_id, product_id, size_label, quantity, expires_at)
    values (p_order_id, v_product.id, v_request.item_size, v_request.quantity, v_expiry);

    v_reserved_after := v_reserved_before + v_request.quantity;
    v_available_after := greatest(0, v_physical_quantity - v_reserved_after);
    v_sold := case when coalesce(v_product.raw->'stock'->>'sold', '') ~ '^-?[0-9]+$'
      then greatest(0, (v_product.raw->'stock'->>'sold')::integer) else 0 end;
    update public.products set
      sizes = v_sizes,
      qty = v_available_after,
      raw = jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(raw, '{}'::jsonb), '{sizes}', coalesce(v_sizes, '[]'::jsonb), true),
          '{qty}', to_jsonb(v_available_after), true
        ),
        '{stock}', jsonb_build_object('available', v_available_after, 'reserved', v_reserved_after, 'sold', v_sold), true
      ),
      updated_at = now()
    where id = v_product.id;

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
    jsonb_build_object('lineItems', v_line_items, 'priceSource', 'server:postgres.create_checkout_order', 'reservationSource', 'finance-minus-active')
  );
  perform public.nixp_order_event(p_order_id, 'order_created', 'Customer', 'Stock reserved for one hour while payment is pending.', jsonb_build_object('expiresAt', v_expiry, 'shippingMethod', v_shipping_method));

  insert into public.orders (id, name, title, status, sort, raw) values (
    p_order_id, v_customer->>'name', 'Website order', 'Active', 0,
    jsonb_build_object('id', p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      'customer', coalesce(nullif(v_customer->>'name', ''), nullif(v_customer->>'email', ''), 'Website customer'),
      'email', v_customer->>'email', 'whatsapp', v_customer->>'whatsapp', 'channel', 'Website', 'status', 'Active',
      'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
      'shippingStatus', v_shipping_status, 'shippingMethod', v_shipping_method, 'shippingAddress', coalesce(p_shipping_address, '{}'::jsonb),
      'total', v_total, 'items', (select coalesce(jsonb_agg(value->>'productId'), '[]'::jsonb) from jsonb_array_elements(v_line_items)),
      'lineItems', v_line_items, 'notes', v_customer->>'notes', 'priceSource', 'server:postgres.create_checkout_order',
      'reservationSource', 'finance-minus-active', 'paymentExpiresAt', v_expiry, 'createdAt', now())
  );
  return jsonb_build_object('id', p_order_id, 'status', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved', 'shippingStatus', v_shipping_status, 'shippingMethod', v_shipping_method, 'total', v_total, 'items', v_line_items, 'paymentExpiresAt', v_expiry);
end;
$$;

create or replace function public.issue_shipping_quote(
  p_order_id text,
  p_amount integer,
  p_courier text,
  p_service text default null,
  p_eta text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.order_records%rowtype;
  v_line public.order_lines%rowtype;
  v_product public.products%rowtype;
  v_size jsonb;
  v_sizes jsonb;
  v_state jsonb;
  v_finance_quantity integer;
  v_physical_quantity integer;
  v_reserved_before integer;
  v_reserved_after integer;
  v_available_before integer;
  v_available_after integer;
  v_next_size_quantity integer;
  v_sold integer;
  v_expiry timestamptz := now() + interval '1 hour';
  v_courier text := left(trim(coalesce(p_courier, '')), 80);
  v_service text := nullif(left(trim(coalesce(p_service, '')), 80), '');
  v_eta text := nullif(left(trim(coalesce(p_eta, '')), 120), '');
begin
  if p_amount < 0 then raise exception 'INVALID_SHIPPING_AMOUNT'; end if;
  if v_courier = '' then raise exception 'COURIER_REQUIRED'; end if;
  select * into v_order from public.order_records where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.order_status <> 'Draft' or v_order.payment_status <> 'Unpaid' or v_order.shipping_status <> 'Awaiting Quote' then
    raise exception 'ORDER_NOT_AWAITING_QUOTE';
  end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
  select state into v_state from public.finance_state where key = 'main' for update;

  for v_line in
    select * from public.order_lines where order_id = p_order_id
    order by product_id, coalesce(size_label, ''), id for update
  loop
    select * into v_product from public.products where id = v_line.product_id for update;
    if not found or v_product.publish_status <> 'Published' or v_product.visibility <> 'Public' then
      raise exception 'ITEM_UNAVAILABLE: %', v_line.sku;
    end if;

    select coalesce(sum(quantity), 0)::integer into v_reserved_before
    from public.inventory_reservations
    where product_id = v_product.id and status = 'Active';
    v_finance_quantity := public.finance_inventory_quantity(v_state, v_product.sku);
    v_physical_quantity := coalesce(v_finance_quantity, coalesce(v_product.qty, 0) + v_reserved_before);
    v_available_before := greatest(0, v_physical_quantity - v_reserved_before);
    if v_line.quantity > v_available_before then raise exception 'OUT_OF_STOCK: %', v_line.sku; end if;

    if jsonb_typeof(v_product.sizes) = 'array' and jsonb_array_length(v_product.sizes) > 0 then
      if v_line.size_label is null then raise exception 'SIZE_REQUIRED: %', v_line.sku; end if;
      select value into v_size from jsonb_array_elements(v_product.sizes) size_item(value)
      where value->>'label' = v_line.size_label limit 1;
      if v_size is null then raise exception 'SIZE_UNAVAILABLE: %', v_line.sku; end if;
      v_next_size_quantity := coalesce(nullif(v_size->>'quantity', '')::integer, 0) - v_line.quantity;
      if v_next_size_quantity < 0 then raise exception 'OUT_OF_STOCK: % / %', v_line.sku, v_line.size_label; end if;
      select coalesce(jsonb_agg(
        case when value->>'label' = v_line.size_label then
          jsonb_set(jsonb_set(value, '{quantity}', to_jsonb(v_next_size_quantity), true), '{soldOut}', to_jsonb(v_next_size_quantity <= 0), true)
        else value end order by ordinality
      ), '[]'::jsonb) into v_sizes
      from jsonb_array_elements(v_product.sizes) with ordinality size_item(value, ordinality);
    else
      if v_line.size_label is not null then raise exception 'SIZE_UNAVAILABLE: %', v_line.sku; end if;
      v_sizes := v_product.sizes;
    end if;

    insert into public.inventory_reservations (order_id, product_id, size_label, quantity, expires_at)
    values (p_order_id, v_product.id, v_line.size_label, v_line.quantity, v_expiry);
    v_reserved_after := v_reserved_before + v_line.quantity;
    v_available_after := greatest(0, v_physical_quantity - v_reserved_after);
    v_sold := case when coalesce(v_product.raw->'stock'->>'sold', '') ~ '^-?[0-9]+$'
      then greatest(0, (v_product.raw->'stock'->>'sold')::integer) else 0 end;
    update public.products set
      sizes = v_sizes,
      qty = v_available_after,
      raw = jsonb_set(
        jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{sizes}', coalesce(v_sizes, '[]'::jsonb), true), '{qty}', to_jsonb(v_available_after), true),
        '{stock}', jsonb_build_object('available', v_available_after, 'reserved', v_reserved_after, 'sold', v_sold), true
      ),
      updated_at = now()
    where id = v_product.id;
  end loop;

  update public.shipping_quotes set status = 'Expired', updated_at = now()
  where order_id = p_order_id and status in ('Draft', 'Sent');
  insert into public.shipping_quotes (order_id, provider, courier, service, amount, eta, status, expires_at, selected_at)
  values (p_order_id, 'NIXP Manual Quote', v_courier, v_service, p_amount, v_eta, 'Sent', v_expiry, now());

  update public.order_records set
    order_status = 'Active', payment_status = 'Pending', fulfillment_status = 'Stock Reserved', shipping_status = 'Quote Sent',
    courier = v_courier, shipping_total = p_amount, grand_total = merchandise_total + p_amount,
    payment_expires_at = v_expiry, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reservationSource', 'finance-minus-active'), updated_at = now()
  where id = p_order_id;
  update public.orders set status = 'Active', raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
    'status', 'Active', 'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
    'shippingStatus', 'Quote Sent', 'courier', v_courier, 'shippingService', v_service,
    'shippingTotal', p_amount, 'total', v_order.merchandise_total + p_amount,
    'reservationSource', 'finance-minus-active', 'paymentExpiresAt', v_expiry
  ) where id = p_order_id;
  perform public.nixp_order_event(p_order_id, 'shipping_quote_issued', 'Admin', 'Shipping quote issued and stock reserved for one hour.', jsonb_build_object('courier', v_courier, 'service', v_service, 'amount', p_amount, 'expiresAt', v_expiry));

  return jsonb_build_object(
    'id', p_order_id, 'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
    'shippingStatus', 'Quote Sent', 'merchandiseTotal', v_order.merchandise_total, 'shippingTotal', p_amount,
    'total', v_order.merchandise_total + p_amount, 'paymentExpiresAt', v_expiry,
    'customerAccessToken', v_order.customer_access_token
  );
end;
$$;

create or replace function public.release_expired_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  -- Keep the provider callback grace internal. The customer-facing payment
  -- session still expires after exactly one hour.
  for v_order in
    select id from public.order_records
    where payment_status = 'Pending'
      and payment_expires_at <= now() - interval '5 minutes'
    order by payment_expires_at, id
    for update skip locked
  loop
    perform public.release_order_reservations(
      v_order.id,
      'Expired',
      'Expired',
      'The one-hour payment window and provider callback grace period ended; reserved stock released.'
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expired', v_count);
end;
$$;

create or replace function public.queue_expired_order_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  insert into public.notification_outbox (
    idempotency_key, recipient, reply_to, subject, text_body, html_body
  )
  select
    'customer-expired-' || order_record.id,
    order_record.customer->>'email',
    'contact@nix-p.com',
    'NIXP order expired: ' || order_record.public_reference,
    'NIXP order expired' || E'\n' ||
      'Order: ' || order_record.public_reference || E'\n' ||
      'The one-hour payment window ended before payment was verified. Reserved stock has been released.',
    '<h1>NIXP order expired</h1><p><strong>Order:</strong> ' || order_record.public_reference ||
      '<br>The one-hour payment window ended before payment was verified. Reserved stock has been released.</p>'
  from public.order_records order_record
  where order_record.payment_status = 'Expired'
    and nullif(trim(order_record.customer->>'email'), '') is not null
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Recreate the latest payment ledger function with a narrow provider callback
-- grace. All payment, Finance, reservation, and order mutations remain atomic.
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
  if v_order.payment_expires_at + interval '5 minutes' <= now() then raise exception 'ORDER_EXPIRED'; end if;
  if p_amount <> v_order.grand_total then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
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

revoke all on function public.create_checkout_order(text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.issue_shipping_quote(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.release_expired_orders() from public, anon, authenticated;
revoke all on function public.queue_expired_order_notifications() from public, anon, authenticated;
revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order(text, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.issue_shipping_quote(text, integer, text, text, text) to service_role;
grant execute on function public.release_expired_orders() to service_role;
grant execute on function public.queue_expired_order_notifications() to service_role;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;

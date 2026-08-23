-- Shipping quotes are a separate, server-owned step. We never guess a JNE
-- price or create a payment amount until a quote has been issued.

alter table public.order_records
  add column if not exists shipping_total integer not null default 0 check (shipping_total >= 0),
  add column if not exists customer_access_token text;

update public.order_records
set customer_access_token = replace(gen_random_uuid()::text, '-', '')
where customer_access_token is null;

alter table public.order_records
  alter column customer_access_token set default replace(gen_random_uuid()::text, '-', ''),
  alter column customer_access_token set not null;

create unique index if not exists order_records_customer_access_token_idx
  on public.order_records (customer_access_token);

create index if not exists shipping_quotes_order_status_idx
  on public.shipping_quotes (order_id, status, created_at desc);

create or replace function public.create_shipping_quote_request(
  p_order_id text,
  p_customer jsonb,
  p_items jsonb,
  p_shipping_address jsonb,
  p_shipping_method text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.order_records%rowtype;
  v_product public.products%rowtype;
  v_request record;
  v_total integer := 0;
  v_line_items jsonb := '[]'::jsonb;
  v_package_items jsonb := '[]'::jsonb;
  v_shipping_method text := trim(coalesce(p_shipping_method, ''));
  v_customer jsonb := jsonb_build_object(
    'name', left(trim(coalesce(p_customer->>'name', '')), 160),
    'email', left(trim(coalesce(p_customer->>'email', '')), 254),
    'whatsapp', left(trim(coalesce(p_customer->>'whatsapp', '')), 48),
    'notes', left(trim(coalesce(p_customer->>'notes', '')), 2000)
  );
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if p_order_id !~ '^order-[A-Za-z0-9_-]{8,96}$' then raise exception 'INVALID_ORDER_ID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'CART_EMPTY'; end if;
  if v_shipping_method not in ('JNE', 'GoSend Manual') then raise exception 'INVALID_QUOTE_SHIPPING_METHOD'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id, 0));
  select * into v_existing from public.order_records where id = p_order_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.order_status,
      'paymentStatus', v_existing.payment_status,
      'fulfillmentStatus', v_existing.fulfillment_status,
      'shippingStatus', v_existing.shipping_status,
      'shippingMethod', v_existing.shipping_method,
      'merchandiseTotal', v_existing.merchandise_total,
      'shippingTotal', v_existing.shipping_total,
      'total', v_existing.grand_total,
      'customerAccessToken', v_existing.customer_access_token
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
    select * into v_product from public.products where id = v_request.item_id;
    if not found or v_product.publish_status <> 'Published' or v_product.visibility <> 'Public' then
      raise exception 'ITEM_UNAVAILABLE: %', v_request.item_id;
    end if;
    if v_request.item_size is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(v_product.sizes, '[]'::jsonb)) size_item(value)
      where value->>'label' = v_request.item_size and coalesce(nullif(value->>'quantity', '')::integer, 0) >= v_request.quantity
    ) then
      raise exception 'SIZE_UNAVAILABLE: %', v_product.title;
    end if;
    if v_request.item_size is null and coalesce(v_product.qty, 0) < v_request.quantity then
      raise exception 'OUT_OF_STOCK: %', v_product.title;
    end if;

    v_total := v_total + (v_product.price * v_request.quantity);
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id, 'sku', v_product.sku, 'artist', v_product.artist, 'title', v_product.title,
      'size', coalesce(v_request.item_size, ''), 'quantity', v_request.quantity,
      'unitPrice', v_product.price, 'lineTotal', v_product.price * v_request.quantity
    ));
    v_package_items := v_package_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id, 'sku', v_product.sku, 'title', v_product.title,
      'quantity', v_request.quantity, 'shipping', coalesce(v_product.raw->'shipping', '{}'::jsonb)
    ));
  end loop;

  if jsonb_array_length(v_line_items) = 0 then raise exception 'CART_EMPTY'; end if;

  insert into public.order_records (
    id, public_reference, customer, merchandise_total, shipping_total, grand_total,
    order_status, payment_status, fulfillment_status, shipping_status, shipping_method,
    shipping_address, customer_access_token, metadata
  ) values (
    p_order_id, upper(replace(p_order_id, 'order-', 'NXP-')), v_customer, v_total, 0, v_total,
    'Draft', 'Unpaid', 'Unfulfilled', 'Awaiting Quote', v_shipping_method,
    coalesce(p_shipping_address, '{}'::jsonb), v_token,
    jsonb_build_object('lineItems', v_line_items, 'packageItems', v_package_items, 'priceSource', 'server:postgres.create_shipping_quote_request')
  );

  for v_request in select * from jsonb_array_elements(v_line_items) item(value) loop
    insert into public.order_lines (order_id, product_id, sku, artist, title, size_label, quantity, unit_price, line_total)
    values (
      p_order_id, v_request.value->>'productId', v_request.value->>'sku', v_request.value->>'artist', v_request.value->>'title',
      nullif(v_request.value->>'size', ''), (v_request.value->>'quantity')::integer,
      (v_request.value->>'unitPrice')::integer, (v_request.value->>'lineTotal')::integer
    );
  end loop;

  insert into public.shipping_quotes (order_id, provider, courier, amount, status, payload)
  values (p_order_id, 'NIXP Manual Quote', v_shipping_method, 0, 'Draft', jsonb_build_object('packageItems', v_package_items));

  insert into public.orders (id, name, title, status, sort, raw) values (
    p_order_id, v_customer->>'name', 'Website shipping quote', 'Draft', 0,
    jsonb_build_object(
      'id', p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      'customer', coalesce(nullif(v_customer->>'name', ''), nullif(v_customer->>'email', ''), 'Website customer'),
      'email', v_customer->>'email', 'whatsapp', v_customer->>'whatsapp', 'channel', 'Website', 'status', 'Draft',
      'orderStatus', 'Draft', 'paymentStatus', 'Unpaid', 'fulfillmentStatus', 'Unfulfilled',
      'shippingStatus', 'Awaiting Quote', 'shippingMethod', v_shipping_method,
      'shippingAddress', coalesce(p_shipping_address, '{}'::jsonb),
      'merchandiseTotal', v_total, 'shippingTotal', 0, 'total', v_total,
      'items', (select coalesce(jsonb_agg(value->>'productId'), '[]'::jsonb) from jsonb_array_elements(v_line_items)),
      'lineItems', v_line_items, 'notes', v_customer->>'notes', 'priceSource', 'server:postgres.create_shipping_quote_request'
    )
  );
  perform public.nixp_order_event(p_order_id, 'shipping_quote_requested', 'Customer', 'Delivery quote requested before payment.', jsonb_build_object('shippingMethod', v_shipping_method));

  return jsonb_build_object(
    'id', p_order_id, 'status', 'Draft', 'paymentStatus', 'Unpaid', 'fulfillmentStatus', 'Unfulfilled',
    'shippingStatus', 'Awaiting Quote', 'shippingMethod', v_shipping_method,
    'merchandiseTotal', v_total, 'shippingTotal', 0, 'total', v_total, 'items', v_line_items,
    'customerAccessToken', v_token
  );
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
  v_next_quantity integer;
  v_stock_total integer;
  v_expiry timestamptz := now() + interval '2 hours';
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

  for v_line in select * from public.order_lines where order_id = p_order_id order by created_at asc for update loop
    select * into v_product from public.products where id = v_line.product_id for update;
    if not found or v_product.publish_status <> 'Published' or v_product.visibility <> 'Public' then
      raise exception 'ITEM_UNAVAILABLE: %', v_line.sku;
    end if;
    if v_line.size_label is not null and jsonb_typeof(v_product.sizes) = 'array' then
      select value into v_size from jsonb_array_elements(v_product.sizes) size_item(value)
      where value->>'label' = v_line.size_label limit 1;
      if v_size is null then raise exception 'SIZE_UNAVAILABLE: %', v_line.sku; end if;
      v_next_quantity := coalesce(nullif(v_size->>'quantity', '')::integer, 0) - v_line.quantity;
      if v_next_quantity < 0 then raise exception 'OUT_OF_STOCK: %', v_line.sku; end if;
      select coalesce(jsonb_agg(case when value->>'label' = v_line.size_label then
        jsonb_set(jsonb_set(value, '{quantity}', to_jsonb(v_next_quantity), true), '{soldOut}', to_jsonb(v_next_quantity <= 0), true)
        else value end), '[]'::jsonb) into v_sizes
      from jsonb_array_elements(v_product.sizes) size_item(value);
      select coalesce(sum(coalesce(nullif(value->>'quantity', '')::integer, 0)), 0)::integer into v_stock_total
      from jsonb_array_elements(v_sizes) size_item(value);
      update public.products set sizes = v_sizes, qty = v_stock_total,
        raw = jsonb_set(jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{sizes}', v_sizes, true), '{qty}', to_jsonb(v_stock_total), true),
          '{stock}', jsonb_build_object('available', v_stock_total, 'reserved', coalesce((raw->'stock'->>'reserved')::integer, 0) + v_line.quantity, 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)), true),
        updated_at = now() where id = v_product.id;
    else
      v_next_quantity := coalesce(v_product.qty, 0) - v_line.quantity;
      if v_next_quantity < 0 then raise exception 'OUT_OF_STOCK: %', v_line.sku; end if;
      update public.products set qty = v_next_quantity,
        raw = jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_next_quantity), true),
          '{stock}', jsonb_build_object('available', v_next_quantity, 'reserved', coalesce((raw->'stock'->>'reserved')::integer, 0) + v_line.quantity, 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)), true),
        updated_at = now() where id = v_product.id;
    end if;
    insert into public.inventory_reservations (order_id, product_id, size_label, quantity, expires_at)
    values (p_order_id, v_product.id, v_line.size_label, v_line.quantity, v_expiry);
  end loop;

  update public.shipping_quotes set status = 'Expired', updated_at = now()
  where order_id = p_order_id and status in ('Draft', 'Sent');
  insert into public.shipping_quotes (order_id, provider, courier, service, amount, eta, status, expires_at, selected_at)
  values (p_order_id, 'NIXP Manual Quote', v_courier, v_service, p_amount, v_eta, 'Sent', v_expiry, now());

  update public.order_records set
    order_status = 'Active', payment_status = 'Pending', fulfillment_status = 'Stock Reserved', shipping_status = 'Quote Sent',
    courier = v_courier, shipping_total = p_amount, grand_total = merchandise_total + p_amount,
    payment_expires_at = v_expiry, updated_at = now()
  where id = p_order_id;
  update public.orders set status = 'Active', raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
    'status', 'Active', 'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
    'shippingStatus', 'Quote Sent', 'courier', v_courier, 'shippingService', v_service,
    'shippingTotal', p_amount, 'total', v_order.merchandise_total + p_amount, 'paymentExpiresAt', v_expiry
  ) where id = p_order_id;
  perform public.nixp_order_event(p_order_id, 'shipping_quote_issued', 'Admin', 'Shipping quote issued and stock reserved for payment.', jsonb_build_object('courier', v_courier, 'service', v_service, 'amount', p_amount, 'expiresAt', v_expiry));

  return jsonb_build_object(
    'id', p_order_id, 'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
    'shippingStatus', 'Quote Sent', 'merchandiseTotal', v_order.merchandise_total, 'shippingTotal', p_amount,
    'total', v_order.merchandise_total + p_amount, 'paymentExpiresAt', v_expiry,
    'customerAccessToken', v_order.customer_access_token
  );
end;
$$;

revoke all on function public.create_shipping_quote_request(text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.issue_shipping_quote(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.create_shipping_quote_request(text, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.issue_shipping_quote(text, integer, text, text, text) to service_role;

-- Packing standards: record formats use cardboard plus bubble wrap. Apparel
-- uses a protective poly mailer as requested. These are operational estimates
-- and stay editable in the admin editor when a physical measurement is taken.
update public.products
set raw = jsonb_set(
  coalesce(raw, '{}'::jsonb),
  '{shipping}',
  case
    when category = 'Records' and format = 'Vinyl' and coalesce(raw->>'edition', '') ~* '(2LP|2xLP|double)'
      then jsonb_build_object('weightGrams', 820, 'lengthCm', 35, 'widthCm', 35, 'heightCm', 6, 'shippingClass', 'vinyl-double-cardboard-bubble', 'packageType', 'double-lp-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: double vinyl, cardboard mailer and bubble wrap', 'updatedAt', now()::date)
    when category = 'Records' and format = 'Vinyl'
      then jsonb_build_object('weightGrams', 550, 'lengthCm', 35, 'widthCm', 35, 'heightCm', 4, 'shippingClass', 'vinyl-cardboard-bubble', 'packageType', 'lp-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: vinyl, cardboard mailer and bubble wrap', 'updatedAt', now()::date)
    when category = 'Records' and format = 'CD'
      then jsonb_build_object('weightGrams', 200, 'lengthCm', 16, 'widthCm', 14, 'heightCm', 3, 'shippingClass', 'cd-cardboard-bubble', 'packageType', 'cd-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: CD, cardboard mailer and bubble wrap', 'updatedAt', now()::date)
    when category = 'Records' and format = 'Cassette'
      then jsonb_build_object('weightGrams', 160, 'lengthCm', 16, 'widthCm', 12, 'heightCm', 3, 'shippingClass', 'cassette-cardboard-bubble', 'packageType', 'cassette-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: cassette, cardboard mailer and bubble wrap', 'updatedAt', now()::date)
    when category = 'Apparel' and lower(title) ~ '(crewneck|sweatshirt|knitsweater|sweater)'
      then jsonb_build_object('weightGrams', 800, 'lengthCm', 40, 'widthCm', 32, 'heightCm', 7, 'shippingClass', 'apparel-poly-heavy', 'packageType', 'poly-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: folded heavy apparel in protective poly mailer', 'updatedAt', now()::date)
    when category = 'Apparel' and lower(title) ~ '(longsleeve|long sleeve)'
      then jsonb_build_object('weightGrams', 360, 'lengthCm', 36, 'widthCm', 28, 'heightCm', 4, 'shippingClass', 'apparel-poly-medium', 'packageType', 'poly-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: folded longsleeve in protective poly mailer', 'updatedAt', now()::date)
    when category = 'Apparel' and lower(title) ~ '(cap|hat)'
      then jsonb_build_object('weightGrams', 180, 'lengthCm', 30, 'widthCm', 25, 'heightCm', 12, 'shippingClass', 'apparel-poly-cap', 'packageType', 'poly-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: cap in protective poly mailer', 'updatedAt', now()::date)
    when category = 'Apparel'
      then jsonb_build_object('weightGrams', 280, 'lengthCm', 36, 'widthCm', 28, 'heightCm', 3, 'shippingClass', 'apparel-poly-light', 'packageType', 'poly-mailer', 'status', 'format_reference', 'source', 'NIXP packing standard: folded apparel in protective poly mailer', 'updatedAt', now()::date)
    else jsonb_build_object('weightGrams', 650, 'lengthCm', 30, 'widthCm', 25, 'heightCm', 12, 'shippingClass', 'object-protective-box', 'packageType', 'protective-box', 'status', 'format_reference', 'source', 'NIXP packing standard: object in cardboard and bubble wrap', 'updatedAt', now()::date)
  end,
  true
), updated_at = now()
where publish_status = 'Published' and visibility = 'Public';

-- Finance records merchandise revenue separately from collected delivery.
-- This keeps shipping pass-through from inflating NIXP's gross profit.
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
  v_shipping_status text;
begin
  select * into v_order from public.order_records where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'Paid' then return jsonb_build_object('id', v_order.id, 'paymentStatus', 'Paid', 'idempotent', true); end if;
  if v_order.payment_status not in ('Pending', 'Unpaid') then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if v_order.payment_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;
  if p_amount <> v_order.grand_total then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;

  for v_reservation in select * from public.inventory_reservations where order_id = p_order_id and status = 'Active' for update loop
    select * into v_product from public.products where id = v_reservation.product_id for update;
    if found then
      update public.products set
        raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{stock}', jsonb_build_object(
          'available', qty,
          'reserved', greatest(0, coalesce((raw->'stock'->>'reserved')::integer, 0) - v_reservation.quantity),
          'sold', coalesce((raw->'stock'->>'sold')::integer, 0) + v_reservation.quantity
        ), true),
        updated_at = now()
      where id = v_product.id;
    end if;
    update public.inventory_reservations set status = 'Converted', updated_at = now() where id = v_reservation.id;
  end loop;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;
  select state into v_state from public.finance_state where key = 'main' for update;

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
  where lines.order_id = p_order_id;

  v_sale := jsonb_build_object(
    'id', 'sale-' || p_order_id,
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
    'invoice', p_order_id,
    'category', 'Retail',
    'sku', (select string_agg(case when coalesce(size_label, '') <> '' then sku || '/' || size_label else sku end, ', ') from public.order_lines where order_id = p_order_id),
    'qty', (select coalesce(sum(quantity), 0) from public.order_lines where order_id = p_order_id),
    'revenue', v_order.merchandise_total,
    'shippingCollected', v_order.shipping_total,
    'totalCollected', v_order.grand_total,
    'discount', v_order.discount_total,
    'discountContext', '',
    'cogs', v_cogs,
    'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end,
    'missingCogsSkus', v_missing_cogs,
    'grossProfit', v_order.merchandise_total - v_order.discount_total - v_cogs,
    'paymentMethod', p_provider
  );
  v_state := jsonb_set(coalesce(v_state, '{}'::jsonb), '{sales}', coalesce(v_state->'sales', '[]'::jsonb) || jsonb_build_array(v_sale), true);
  update public.finance_state set state = v_state, updated_at = now() where key = 'main';

  v_shipping_status := case when v_order.shipping_method in ('JNE', 'GoSend Manual') then 'Awaiting Pickup' else 'Not Required' end;
  update public.order_records set
    order_status = 'Active', payment_status = 'Paid', fulfillment_status = 'Processing', shipping_status = v_shipping_status,
    paid_at = now(), updated_at = now()
  where id = p_order_id;
  update public.orders set status = 'Paid', raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
    'status', 'Paid', 'orderStatus', 'Active', 'paymentStatus', 'Paid', 'fulfillmentStatus', 'Processing',
    'shippingStatus', v_shipping_status, 'paidAt', now(), 'cogs', v_cogs,
    'cogsStatus', case when jsonb_array_length(v_missing_cogs) > 0 then 'Missing cost basis' else 'Complete' end,
    'merchandiseTotal', v_order.merchandise_total, 'shippingTotal', v_order.shipping_total, 'total', v_order.grand_total
  ) where id = p_order_id;
  update public.payment_attempts set
    provider_transaction_id = nullif(p_provider_transaction_id, ''), status = 'Paid', amount = p_amount,
    payload = coalesce(p_payload, '{}'::jsonb), updated_at = now()
  where provider = p_provider and provider_order_id = nullif(p_provider_order_id, '');
  if not found then
    insert into public.payment_attempts (order_id, provider, provider_transaction_id, provider_order_id, status, amount, payload)
    values (p_order_id, p_provider, nullif(p_provider_transaction_id, ''), nullif(p_provider_order_id, ''), 'Paid', p_amount, coalesce(p_payload, '{}'::jsonb));
  end if;
  perform public.nixp_order_event(p_order_id, 'payment_paid', 'Payment Provider', 'Verified payment received; order moved to processing.', jsonb_build_object('provider', p_provider, 'transactionId', p_provider_transaction_id, 'cogs', v_cogs, 'missingCogsSkus', v_missing_cogs));
  return jsonb_build_object('id', p_order_id, 'orderStatus', 'Active', 'paymentStatus', 'Paid', 'fulfillmentStatus', 'Processing', 'shippingStatus', v_shipping_status, 'cogs', v_cogs, 'missingCogsSkus', v_missing_cogs);
end;
$$;

revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;

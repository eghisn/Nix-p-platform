-- NIXP commerce foundation. All mutations run through server-side service-role
-- routes and these functions; no customer-controlled price is ever accepted.

create table if not exists public.order_records (
  id text primary key,
  public_reference text not null unique,
  customer jsonb not null default '{}'::jsonb,
  currency text not null default 'IDR' check (currency = 'IDR'),
  merchandise_total integer not null default 0 check (merchandise_total >= 0),
  shipping_total integer not null default 0 check (shipping_total >= 0),
  discount_total integer not null default 0 check (discount_total >= 0),
  grand_total integer not null default 0 check (grand_total >= 0),
  order_status text not null default 'Draft' check (order_status in ('Draft', 'Active', 'Completed', 'Cancelled', 'Expired', 'Refunded')),
  payment_status text not null default 'Unpaid' check (payment_status in ('Unpaid', 'Pending', 'Paid', 'Failed', 'Expired', 'Refund Pending', 'Partially Refunded', 'Refunded')),
  fulfillment_status text not null default 'Unfulfilled' check (fulfillment_status in ('Unfulfilled', 'Stock Reserved', 'Processing', 'Packed', 'Ready for Pickup', 'Fulfilled', 'Returned')),
  shipping_status text not null default 'Not Required' check (shipping_status in ('Not Required', 'Awaiting Quote', 'Quote Sent', 'Awaiting Selection', 'Awaiting Pickup', 'In Transit', 'Delivered', 'Delivery Failed', 'Returned to Sender')),
  shipping_method text,
  courier text,
  tracking_number text,
  shipping_address jsonb not null default '{}'::jsonb,
  payment_expires_at timestamptz,
  paid_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.order_records(id) on delete cascade,
  product_id text not null references public.products(id),
  sku text not null,
  artist text,
  title text not null,
  size_label text,
  quantity integer not null check (quantity > 0 and quantity <= 20),
  unit_price integer not null check (unit_price >= 0),
  line_total integer not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, product_id, size_label)
);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.order_records(id) on delete cascade,
  product_id text not null references public.products(id),
  size_label text,
  quantity integer not null check (quantity > 0),
  status text not null default 'Active' check (status in ('Active', 'Converted', 'Released', 'Returned Pending Inspection')),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id, size_label)
);

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.order_records(id) on delete cascade,
  provider text not null check (provider in ('Midtrans', 'Manual', 'Bank Transfer')),
  provider_transaction_id text,
  provider_order_id text,
  status text not null default 'Pending',
  amount integer not null check (amount >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_order_id),
  unique (provider, provider_transaction_id)
);

create table if not exists public.shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.order_records(id) on delete cascade,
  provider text not null,
  courier text,
  service text,
  amount integer not null check (amount >= 0),
  eta text,
  status text not null default 'Draft' check (status in ('Draft', 'Sent', 'Selected', 'Expired', 'Rejected')),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.order_records(id) on delete cascade,
  provider text,
  courier text,
  service text,
  tracking_number text,
  status text not null default 'Awaiting Pickup',
  label_url text,
  payload jsonb not null default '{}'::jsonb,
  handed_to_courier_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.order_records(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('Customer', 'Admin', 'System', 'Payment Provider', 'Courier')),
  actor_id text,
  message text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_key)
);

create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.order_records(id),
  status text not null default 'Return Requested' check (status in ('Return Requested', 'Return Approved', 'Return In Transit', 'Returned', 'Inspection', 'Refunded', 'Rejected')),
  reason text,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_records_status_idx on public.order_records (order_status, payment_status, fulfillment_status, shipping_status, created_at desc);
create index if not exists order_records_expiry_idx on public.order_records (payment_expires_at) where payment_status = 'Pending';
create index if not exists order_lines_order_idx on public.order_lines (order_id);
create index if not exists inventory_reservations_active_idx on public.inventory_reservations (product_id, size_label, expires_at) where status = 'Active';
create index if not exists order_events_order_idx on public.order_events (order_id, created_at desc);

alter table public.order_records enable row level security;
alter table public.order_lines enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.shipping_quotes enable row level security;
alter table public.shipments enable row level security;
alter table public.order_events enable row level security;
alter table public.webhook_receipts enable row level security;
alter table public.return_requests enable row level security;

-- Explicitly deny Data API access to operational tables. The service role
-- bypasses RLS; no anon/authenticated grants or policies are introduced here.
revoke all on public.order_records, public.order_lines, public.inventory_reservations,
  public.payment_attempts, public.shipping_quotes, public.shipments, public.order_events,
  public.webhook_receipts, public.return_requests from anon, authenticated;

create or replace function public.nixp_order_event(
  p_order_id text,
  p_event_type text,
  p_actor_type text,
  p_message text,
  p_data jsonb default '{}'::jsonb
) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.order_events (order_id, event_type, actor_type, message, data)
  values (p_order_id, p_event_type, p_actor_type, p_message, coalesce(p_data, '{}'::jsonb));
$$;

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
  v_customer jsonb := jsonb_build_object(
    'name', left(trim(coalesce(p_customer->>'name', '')), 160),
    'email', left(trim(coalesce(p_customer->>'email', '')), 254),
    'whatsapp', left(trim(coalesce(p_customer->>'whatsapp', '')), 48),
    'notes', left(trim(coalesce(p_customer->>'notes', '')), 2000)
  );
begin
  if p_order_id !~ '^order-[A-Za-z0-9_-]{8,96}$' then raise exception 'INVALID_ORDER_ID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'CART_EMPTY'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id, 0));
  select * into v_existing from public.order_records where id = p_order_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.order_status, 'paymentStatus', v_existing.payment_status,
      'fulfillmentStatus', v_existing.fulfillment_status, 'shippingStatus', v_existing.shipping_status,
      'total', v_existing.grand_total, 'paymentExpiresAt', v_existing.payment_expires_at
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
    'Active', 'Pending', 'Stock Reserved', case when coalesce(p_shipping_method, '') = '' then 'Not Required' else 'Awaiting Quote' end,
    nullif(trim(coalesce(p_shipping_method, '')), ''), coalesce(p_shipping_address, '{}'::jsonb), v_expiry,
    jsonb_build_object('lineItems', v_line_items, 'priceSource', 'server:postgres.create_checkout_order')
  );
  perform public.nixp_order_event(p_order_id, 'order_created', 'Customer', 'Stock reserved for two hours while payment is pending.', jsonb_build_object('expiresAt', v_expiry));

  -- Keep the current admin UI supplied while it moves to order_records.
  insert into public.orders (id, name, title, status, sort, raw) values (
    p_order_id, v_customer->>'name', 'Website order', 'Active', 0,
    jsonb_build_object('id', p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      'customer', coalesce(nullif(v_customer->>'name', ''), nullif(v_customer->>'email', ''), 'Website customer'),
      'email', v_customer->>'email', 'whatsapp', v_customer->>'whatsapp', 'channel', 'Website', 'status', 'Active',
      'orderStatus', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved',
      'shippingStatus', case when coalesce(p_shipping_method, '') = '' then 'Not Required' else 'Awaiting Quote' end,
      'total', v_total, 'items', (select coalesce(jsonb_agg(value->>'productId'), '[]'::jsonb) from jsonb_array_elements(v_line_items)),
      'lineItems', v_line_items, 'notes', v_customer->>'notes', 'priceSource', 'server:postgres.create_checkout_order',
      'paymentExpiresAt', v_expiry, 'createdAt', now())
  );
  return jsonb_build_object('id', p_order_id, 'status', 'Active', 'paymentStatus', 'Pending', 'fulfillmentStatus', 'Stock Reserved', 'shippingStatus', case when coalesce(p_shipping_method, '') = '' then 'Not Required' else 'Awaiting Quote' end, 'total', v_total, 'items', v_line_items, 'paymentExpiresAt', v_expiry);
end;
$$;

create or replace function public.release_expired_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order public.order_records%rowtype; v_reservation public.inventory_reservations%rowtype; v_product public.products%rowtype; v_sizes jsonb; v_stock_total integer; v_count integer := 0;
begin
  for v_order in select * from public.order_records where payment_status = 'Pending' and payment_expires_at <= now() for update skip locked loop
    for v_reservation in select * from public.inventory_reservations where order_id = v_order.id and status = 'Active' for update loop
      select * into v_product from public.products where id = v_reservation.product_id for update;
      if found then
        if v_reservation.size_label is not null and jsonb_typeof(v_product.sizes) = 'array' then
          select coalesce(jsonb_agg(case when value->>'label' = v_reservation.size_label then
            jsonb_set(jsonb_set(value, '{quantity}', to_jsonb(coalesce(nullif(value->>'quantity', '')::integer, 0) + v_reservation.quantity), true), '{soldOut}', 'false'::jsonb, true)
            else value end), '[]'::jsonb) into v_sizes from jsonb_array_elements(v_product.sizes) size_item(value);
          select coalesce(sum(coalesce(nullif(value->>'quantity', '')::integer, 0)), 0)::integer into v_stock_total from jsonb_array_elements(v_sizes) size_item(value);
          update public.products set sizes=v_sizes, qty=v_stock_total,
            raw=jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_stock_total), true), '{stock}', jsonb_build_object('available', v_stock_total, 'reserved', greatest(0, coalesce((raw->'stock'->>'reserved')::integer, 0)-v_reservation.quantity), 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)), true), updated_at=now() where id=v_product.id;
        else
          v_stock_total := coalesce(v_product.qty, 0) + v_reservation.quantity;
          update public.products set qty=v_stock_total,
            raw=jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_stock_total), true), '{stock}', jsonb_build_object('available', v_stock_total, 'reserved', greatest(0, coalesce((raw->'stock'->>'reserved')::integer, 0)-v_reservation.quantity), 'sold', coalesce((raw->'stock'->>'sold')::integer, 0)), true), updated_at=now() where id=v_product.id;
        end if;
      end if;
      update public.inventory_reservations set status='Released', released_at=now(), updated_at=now() where id=v_reservation.id;
    end loop;
    update public.order_records set order_status='Expired', payment_status='Expired', fulfillment_status='Unfulfilled', updated_at=now() where id=v_order.id;
    update public.orders set status='Expired', raw=jsonb_set(jsonb_set(coalesce(raw, '{}'::jsonb), '{status}', '"Expired"'::jsonb, true), '{paymentStatus}', '"Expired"'::jsonb, true), updated_at=now() where id=v_order.id;
    perform public.nixp_order_event(v_order.id, 'payment_expired', 'System', 'Payment was not completed within two hours; stock released.');
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expired', v_count);
end;
$$;

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
declare v_order public.order_records%rowtype; v_reservation public.inventory_reservations%rowtype; v_product public.products%rowtype; v_state jsonb; v_sale jsonb; v_line jsonb;
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
  v_sale := jsonb_build_object('id', 'sale-' || p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), 'invoice', p_order_id, 'category', 'Retail', 'sku', (select string_agg(case when coalesce(size_label,'') <> '' then sku || '/' || size_label else sku end, ', ') from public.order_lines where order_id=p_order_id), 'qty', (select coalesce(sum(quantity),0) from public.order_lines where order_id=p_order_id), 'revenue', v_order.grand_total, 'discount', v_order.discount_total, 'discountContext', '', 'cogs', 0, 'grossProfit', v_order.grand_total-v_order.discount_total, 'paymentMethod', p_provider);
  v_state := jsonb_set(coalesce(v_state, '{}'::jsonb), '{sales}', coalesce(v_state->'sales','[]'::jsonb) || jsonb_build_array(v_sale), true);
  update public.finance_state set state=v_state, updated_at=now() where key='main';
  update public.order_records set order_status='Active', payment_status='Paid', fulfillment_status='Processing', paid_at=now(), updated_at=now() where id=p_order_id;
  update public.orders set status='Paid', raw=coalesce(raw, '{}'::jsonb) || jsonb_build_object('status','Paid','orderStatus','Active','paymentStatus','Paid','fulfillmentStatus','Processing','paidAt',now()) where id=p_order_id;
  insert into public.payment_attempts (order_id, provider, provider_transaction_id, provider_order_id, status, amount, payload) values (p_order_id, p_provider, nullif(p_provider_transaction_id,''), nullif(p_provider_order_id,''), 'Paid', p_amount, coalesce(p_payload,'{}'::jsonb)) on conflict (provider, provider_transaction_id) do update set status='Paid', payload=excluded.payload, updated_at=now();
  perform public.nixp_order_event(p_order_id, 'payment_paid', 'Payment Provider', 'Verified payment received; order moved to processing.', jsonb_build_object('provider',p_provider,'transactionId',p_provider_transaction_id));
  return jsonb_build_object('id',p_order_id,'orderStatus','Active','paymentStatus','Paid','fulfillmentStatus','Processing');
end;
$$;

revoke all on function public.create_checkout_order(text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.release_expired_orders() from public, anon, authenticated;
revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order(text, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.release_expired_orders() to service_role;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;

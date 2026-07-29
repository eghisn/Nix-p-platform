-- Supabase provides gen_random_uuid(), while this project does not expose
-- gen_random_bytes(). Keep the token URL-safe and non-guessable without an
-- extra extension dependency.
alter table public.order_records
  alter column customer_access_token set default replace(gen_random_uuid()::text, '-', '');

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
      'id', v_existing.id, 'status', v_existing.order_status, 'paymentStatus', v_existing.payment_status,
      'fulfillmentStatus', v_existing.fulfillment_status, 'shippingStatus', v_existing.shipping_status,
      'shippingMethod', v_existing.shipping_method, 'merchandiseTotal', v_existing.merchandise_total,
      'shippingTotal', v_existing.shipping_total, 'total', v_existing.grand_total,
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
    values (p_order_id, v_request.value->>'productId', v_request.value->>'sku', v_request.value->>'artist', v_request.value->>'title', nullif(v_request.value->>'size', ''), (v_request.value->>'quantity')::integer, (v_request.value->>'unitPrice')::integer, (v_request.value->>'lineTotal')::integer);
  end loop;
  insert into public.shipping_quotes (order_id, provider, courier, amount, status, payload)
  values (p_order_id, 'NIXP Manual Quote', v_shipping_method, 0, 'Draft', jsonb_build_object('packageItems', v_package_items));
  insert into public.orders (id, name, title, status, sort, raw) values (
    p_order_id, v_customer->>'name', 'Website shipping quote', 'Draft', 0,
    jsonb_build_object('id', p_order_id, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), 'customer', coalesce(nullif(v_customer->>'name', ''), nullif(v_customer->>'email', ''), 'Website customer'), 'email', v_customer->>'email', 'whatsapp', v_customer->>'whatsapp', 'channel', 'Website', 'status', 'Draft', 'orderStatus', 'Draft', 'paymentStatus', 'Unpaid', 'fulfillmentStatus', 'Unfulfilled', 'shippingStatus', 'Awaiting Quote', 'shippingMethod', v_shipping_method, 'shippingAddress', coalesce(p_shipping_address, '{}'::jsonb), 'merchandiseTotal', v_total, 'shippingTotal', 0, 'total', v_total, 'items', (select coalesce(jsonb_agg(value->>'productId'), '[]'::jsonb) from jsonb_array_elements(v_line_items)), 'lineItems', v_line_items, 'notes', v_customer->>'notes', 'priceSource', 'server:postgres.create_shipping_quote_request')
  );
  perform public.nixp_order_event(p_order_id, 'shipping_quote_requested', 'Customer', 'Delivery quote requested before payment.', jsonb_build_object('shippingMethod', v_shipping_method));
  return jsonb_build_object('id', p_order_id, 'status', 'Draft', 'paymentStatus', 'Unpaid', 'fulfillmentStatus', 'Unfulfilled', 'shippingStatus', 'Awaiting Quote', 'shippingMethod', v_shipping_method, 'merchandiseTotal', v_total, 'shippingTotal', 0, 'total', v_total, 'items', v_line_items, 'customerAccessToken', v_token);
end;
$$;

revoke all on function public.create_shipping_quote_request(text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_shipping_quote_request(text, jsonb, jsonb, jsonb, text) to service_role;

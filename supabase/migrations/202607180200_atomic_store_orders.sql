create or replace function public.submit_store_order(
  p_order_id text,
  p_customer jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_state jsonb;
  v_inventory_stock jsonb;
  v_line_items jsonb := '[]'::jsonb;
  v_sale jsonb;
  v_order jsonb;
  v_request record;
  v_product public.products%rowtype;
  v_size jsonb;
  v_sizes jsonb;
  v_stock_total integer;
  v_next_quantity integer;
  v_total integer := 0;
  v_customer_name text := left(trim(coalesce(p_customer->>'name', '')), 160);
  v_customer_email text := left(trim(coalesce(p_customer->>'email', '')), 254);
  v_customer_whatsapp text := left(trim(coalesce(p_customer->>'whatsapp', '')), 48);
  v_customer_notes text := left(trim(coalesce(p_customer->>'notes', '')), 2000);
begin
  if p_order_id !~ '^order-[A-Za-z0-9_-]{8,96}$' then
    raise exception 'INVALID_ORDER_ID';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CART_EMPTY';
  end if;

  -- The lock makes a retried checkout idempotent without serializing unrelated orders.
  perform pg_advisory_xact_lock(hashtextextended(p_order_id, 0));
  select raw into v_existing from public.orders where id = p_order_id;
  if found then
    return v_existing;
  end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[]}'::jsonb)
  on conflict (key) do nothing;

  select state into v_state from public.finance_state where key = 'main' for update;
  v_inventory_stock := coalesce(v_state->'inventoryStock', '[]'::jsonb);

  for v_request in
    select item_id, item_size, sum(quantity)::integer as quantity
    from (
      select
        nullif(trim(item.value->>'id'), '') as item_id,
        nullif(trim(item.value->>'size'), '') as item_size,
        least(
          20,
          greatest(
            1,
            case when coalesce(item.value->>'quantity', '') ~ '^[0-9]+$'
              then (item.value->>'quantity')::integer
              else 1
            end
          )
        ) as quantity
      from jsonb_array_elements(p_items) as item(value)
    ) as requested
    where item_id is not null
    group by item_id, item_size
    order by item_id, item_size nulls first
  loop
    select * into v_product from public.products where id = v_request.item_id for update;
    if not found then
      raise exception 'ITEM_UNAVAILABLE: %', v_request.item_id;
    end if;
    if v_product.publish_status <> 'Published' or v_product.visibility <> 'Public' then
      raise exception 'ITEM_UNAVAILABLE: %', v_product.title;
    end if;

    if jsonb_typeof(v_product.sizes) = 'array' and jsonb_array_length(v_product.sizes) > 0 then
      if v_request.item_size is null then
        raise exception 'SIZE_REQUIRED: %', v_product.title;
      end if;
      select value into v_size
      from jsonb_array_elements(v_product.sizes) as size_item(value)
      where size_item.value->>'label' = v_request.item_size
      limit 1;
      if v_size is null then
        raise exception 'SIZE_UNAVAILABLE: %', v_product.title;
      end if;
      v_next_quantity := coalesce(nullif(v_size->>'quantity', '')::integer, 0) - v_request.quantity;
      if v_next_quantity < 0 then
        raise exception 'OUT_OF_STOCK: % / %', v_product.title, v_request.item_size;
      end if;
      select coalesce(
        jsonb_agg(
          case when size_item.value->>'label' = v_request.item_size then
            jsonb_set(
              jsonb_set(size_item.value, '{quantity}', to_jsonb(v_next_quantity), true),
              '{soldOut}',
              to_jsonb(v_next_quantity <= 0),
              true
            )
          else size_item.value end
        ),
        '[]'::jsonb
      ) into v_sizes
      from jsonb_array_elements(v_product.sizes) as size_item(value);
      select coalesce(sum(coalesce(nullif(size_item.value->>'quantity', '')::integer, 0)), 0)::integer
      into v_stock_total
      from jsonb_array_elements(v_sizes) as size_item(value);

      update public.products
      set
        sizes = v_sizes,
        qty = v_stock_total,
        raw = jsonb_set(
          jsonb_set(coalesce(raw, '{}'::jsonb), '{sizes}', v_sizes, true),
          '{qty}',
          to_jsonb(v_stock_total),
          true
        ),
        updated_at = now()
      where id = v_product.id;
    else
      v_next_quantity := coalesce(v_product.qty, 0) - v_request.quantity;
      if v_next_quantity < 0 then
        raise exception 'OUT_OF_STOCK: %', v_product.title;
      end if;
      v_stock_total := v_next_quantity;
      update public.products
      set
        qty = v_next_quantity,
        raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_next_quantity), true),
        updated_at = now()
      where id = v_product.id;
    end if;

    update public.inventory
    set
      status = case when v_stock_total > 0 then 'In stock' else 'Sold out' end,
      raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{qty}', to_jsonb(v_stock_total), true),
      updated_at = now()
    where raw->>'productId' = v_product.id;

    v_inventory_stock := (
      select coalesce(
        jsonb_agg(
          case when lower(coalesce(stock_item.value->>'sku', '')) = lower(coalesce(v_product.sku, '')) then
            jsonb_set(stock_item.value, '{qty}', to_jsonb(v_stock_total), true)
          else stock_item.value end
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(v_inventory_stock) as stock_item(value)
    );

    v_total := v_total + (v_product.price * v_request.quantity);
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'sku', v_product.sku,
      'artist', v_product.artist,
      'title', v_product.title,
      'size', coalesce(v_request.item_size, ''),
      'quantity', v_request.quantity,
      'unitPrice', v_product.price,
      'lineTotal', v_product.price * v_request.quantity
    ));
  end loop;

  if jsonb_array_length(v_line_items) = 0 then
    raise exception 'CART_EMPTY';
  end if;

  v_order := jsonb_build_object(
    'id', p_order_id,
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
    'customer', coalesce(nullif(v_customer_name, ''), nullif(v_customer_email, ''), nullif(v_customer_whatsapp, ''), 'Website customer'),
    'email', v_customer_email,
    'whatsapp', v_customer_whatsapp,
    'channel', 'Website',
    'status', 'New',
    'total', v_total,
    'items', (select coalesce(jsonb_agg(line_item.value->>'productId'), '[]'::jsonb) from jsonb_array_elements(v_line_items) as line_item(value)),
    'lineItems', v_line_items,
    'notes', v_customer_notes,
    'priceSource', 'server:postgres.submit_store_order',
    'createdAt', now()
  );

  insert into public.orders (id, name, title, status, sort, raw)
  values (p_order_id, v_customer_name, 'Website order', 'New', 0, v_order);

  v_sale := jsonb_build_object(
    'id', 'sale-' || p_order_id,
    'date', v_order->>'date',
    'invoice', p_order_id,
    'category', 'Retail',
    'sku', (select string_agg(case when coalesce(line_item.value->>'size', '') <> '' then (line_item.value->>'sku') || '/' || (line_item.value->>'size') else line_item.value->>'sku' end, ', ') from jsonb_array_elements(v_line_items) as line_item(value)),
    'qty', (select coalesce(sum((line_item.value->>'quantity')::integer), 0) from jsonb_array_elements(v_line_items) as line_item(value)),
    'revenue', v_total,
    'discount', 0,
    'discountContext', '',
    'cogs', 0,
    'grossProfit', v_total,
    'paymentMethod', 'Pending'
  );
  v_state := jsonb_set(
    jsonb_set(coalesce(v_state, '{}'::jsonb), '{sales}', coalesce(v_state->'sales', '[]'::jsonb) || jsonb_build_array(v_sale), true),
    '{inventoryStock}',
    v_inventory_stock,
    true
  );
  update public.finance_state set state = v_state, updated_at = now() where key = 'main';

  return v_order;
end;
$$;

revoke all on function public.submit_store_order(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_store_order(text, jsonb, jsonb) to service_role;

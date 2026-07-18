-- create_checkout_order writes the parent order after calculating and locking
-- its line items. These references are intentionally checked at transaction
-- commit, allowing the complete order to remain one atomic operation.
alter table public.order_lines
  alter constraint order_lines_order_id_fkey deferrable initially deferred;
alter table public.inventory_reservations
  alter constraint inventory_reservations_order_id_fkey deferrable initially deferred;

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
declare v_order public.order_records%rowtype; v_reservation public.inventory_reservations%rowtype; v_product public.products%rowtype; v_state jsonb; v_sale jsonb;
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
  update public.payment_attempts set provider_transaction_id=nullif(p_provider_transaction_id,''), status='Paid', amount=p_amount, payload=coalesce(p_payload,'{}'::jsonb), updated_at=now() where provider=p_provider and provider_order_id=nullif(p_provider_order_id,'');
  if not found then
    insert into public.payment_attempts (order_id, provider, provider_transaction_id, provider_order_id, status, amount, payload)
    values (p_order_id, p_provider, nullif(p_provider_transaction_id,''), nullif(p_provider_order_id,''), 'Paid', p_amount, coalesce(p_payload,'{}'::jsonb));
  end if;
  perform public.nixp_order_event(p_order_id, 'payment_paid', 'Payment Provider', 'Verified payment received; order moved to processing.', jsonb_build_object('provider',p_provider,'transactionId',p_provider_transaction_id));
  return jsonb_build_object('id',p_order_id,'orderStatus','Active','paymentStatus','Paid','fulfillmentStatus','Processing');
end;
$$;

revoke all on function public.apply_verified_payment(text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(text, text, text, text, integer, jsonb) to service_role;

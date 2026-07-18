create or replace function public.release_order_reservations(
  p_order_id text,
  p_order_status text,
  p_payment_status text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order public.order_records%rowtype; v_reservation public.inventory_reservations%rowtype; v_product public.products%rowtype; v_sizes jsonb; v_available integer;
begin
  if p_order_status not in ('Cancelled', 'Expired') then raise exception 'INVALID_RELEASE_STATUS'; end if;
  if p_payment_status not in ('Unpaid', 'Failed', 'Expired') then raise exception 'INVALID_RELEASE_PAYMENT_STATUS'; end if;
  select * into v_order from public.order_records where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'Paid' then raise exception 'PAID_ORDER_REQUIRES_REFUND_WORKFLOW'; end if;
  for v_reservation in select * from public.inventory_reservations where order_id=p_order_id and status='Active' for update loop
    select * into v_product from public.products where id=v_reservation.product_id for update;
    if found then
      if v_reservation.size_label is not null and jsonb_typeof(v_product.sizes)='array' then
        select coalesce(jsonb_agg(case when value->>'label'=v_reservation.size_label then jsonb_set(jsonb_set(value,'{quantity}',to_jsonb(coalesce(nullif(value->>'quantity','')::integer,0)+v_reservation.quantity),true),'{soldOut}','false'::jsonb,true) else value end),'[]'::jsonb) into v_sizes from jsonb_array_elements(v_product.sizes) size_item(value);
        select coalesce(sum(coalesce(nullif(value->>'quantity','')::integer,0)),0)::integer into v_available from jsonb_array_elements(v_sizes) size_item(value);
        update public.products set sizes=v_sizes, qty=v_available, raw=jsonb_set(jsonb_set(coalesce(raw,'{}'::jsonb),'{qty}',to_jsonb(v_available),true),'{stock}',jsonb_build_object('available',v_available,'reserved',greatest(0,coalesce((raw->'stock'->>'reserved')::integer,0)-v_reservation.quantity),'sold',coalesce((raw->'stock'->>'sold')::integer,0)),true),updated_at=now() where id=v_product.id;
      else
        v_available:=coalesce(v_product.qty,0)+v_reservation.quantity;
        update public.products set qty=v_available, raw=jsonb_set(jsonb_set(coalesce(raw,'{}'::jsonb),'{qty}',to_jsonb(v_available),true),'{stock}',jsonb_build_object('available',v_available,'reserved',greatest(0,coalesce((raw->'stock'->>'reserved')::integer,0)-v_reservation.quantity),'sold',coalesce((raw->'stock'->>'sold')::integer,0)),true),updated_at=now() where id=v_product.id;
      end if;
    end if;
    update public.inventory_reservations set status='Released', released_at=now(), updated_at=now() where id=v_reservation.id;
  end loop;
  update public.order_records set order_status=p_order_status,payment_status=p_payment_status,fulfillment_status='Unfulfilled',updated_at=now(),cancelled_at=case when p_order_status='Cancelled' then now() else cancelled_at end where id=p_order_id;
  update public.orders set status=p_order_status,raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('status',p_order_status,'orderStatus',p_order_status,'paymentStatus',p_payment_status,'fulfillmentStatus','Unfulfilled') where id=p_order_id;
  perform public.nixp_order_event(p_order_id,lower(replace(p_order_status,' ','_')),'System',p_reason);
  return jsonb_build_object('id',p_order_id,'orderStatus',p_order_status,'paymentStatus',p_payment_status);
end;
$$;

create or replace function public.admin_update_order_operation(
  p_order_id text,
  p_fulfillment_status text default null,
  p_shipping_status text default null,
  p_courier text default null,
  p_tracking_number text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order public.order_records%rowtype; v_fulfillment text; v_shipping text;
begin
  select * into v_order from public.order_records where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status <> 'Paid' then raise exception 'ORDER_NOT_PAID'; end if;
  v_fulfillment:=coalesce(nullif(trim(p_fulfillment_status),''),v_order.fulfillment_status);
  v_shipping:=coalesce(nullif(trim(p_shipping_status),''),v_order.shipping_status);
  if v_fulfillment not in ('Unfulfilled','Stock Reserved','Processing','Packed','Ready for Pickup','Fulfilled','Returned') then raise exception 'INVALID_FULFILLMENT_STATUS'; end if;
  if v_shipping not in ('Not Required','Awaiting Quote','Quote Sent','Awaiting Selection','Awaiting Pickup','In Transit','Delivered','Delivery Failed','Returned to Sender') then raise exception 'INVALID_SHIPPING_STATUS'; end if;
  if v_shipping in ('In Transit','Delivered') and nullif(trim(coalesce(p_tracking_number,'')),'') is null then raise exception 'TRACKING_NUMBER_REQUIRED'; end if;
  update public.order_records set fulfillment_status=v_fulfillment,shipping_status=v_shipping,courier=coalesce(nullif(trim(p_courier),''),courier),tracking_number=coalesce(nullif(trim(p_tracking_number),''),tracking_number),order_status=case when v_shipping='Delivered' then 'Completed' else order_status end,completed_at=case when v_shipping='Delivered' then now() else completed_at end,updated_at=now() where id=p_order_id;
  update public.orders set status=case when v_shipping='Delivered' then 'Completed' else status end,raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('orderStatus',case when v_shipping='Delivered' then 'Completed' else v_order.order_status end,'fulfillmentStatus',v_fulfillment,'shippingStatus',v_shipping,'courier',coalesce(nullif(trim(p_courier),''),v_order.courier),'trackingNumber',coalesce(nullif(trim(p_tracking_number),''),v_order.tracking_number)) where id=p_order_id;
  perform public.nixp_order_event(p_order_id,'operations_updated','Admin',coalesce(nullif(trim(p_note),''),'Order operations updated.'),jsonb_build_object('fulfillmentStatus',v_fulfillment,'shippingStatus',v_shipping));
  return (select jsonb_build_object('id',id,'orderStatus',order_status,'paymentStatus',payment_status,'fulfillmentStatus',fulfillment_status,'shippingStatus',shipping_status,'courier',courier,'trackingNumber',tracking_number) from public.order_records where id=p_order_id);
end;
$$;

revoke all on function public.release_order_reservations(text,text,text,text) from public, anon, authenticated;
revoke all on function public.admin_update_order_operation(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.release_order_reservations(text,text,text,text) to service_role;
grant execute on function public.admin_update_order_operation(text,text,text,text,text,text) to service_role;

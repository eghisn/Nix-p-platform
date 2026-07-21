create or replace function public.apply_verified_refund(
  p_order_id text,
  p_provider text,
  p_provider_transaction_id text,
  p_refund_amount integer,
  p_full_refund boolean,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.order_records%rowtype;
  v_payment_status text;
  v_order_status text;
begin
  select * into v_order from public.order_records where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if (p_full_refund and v_order.payment_status = 'Refunded')
    or (not p_full_refund and v_order.payment_status in ('Partially Refunded', 'Refunded')
      and coalesce((v_order.metadata->>'refundedAmount')::integer, 0) >= p_refund_amount) then
    return jsonb_build_object('id', p_order_id, 'orderStatus', v_order.order_status, 'paymentStatus', v_order.payment_status, 'refundAmount', p_refund_amount, 'idempotent', true);
  end if;
  if v_order.payment_status not in ('Paid', 'Refund Pending', 'Partially Refunded', 'Refunded') then
    raise exception 'ORDER_NOT_REFUNDABLE';
  end if;
  if p_refund_amount <= 0 or p_refund_amount > v_order.grand_total then
    raise exception 'INVALID_REFUND_AMOUNT';
  end if;

  v_payment_status := case when p_full_refund then 'Refunded' else 'Partially Refunded' end;
  v_order_status := case when p_full_refund then 'Refunded' else v_order.order_status end;

  update public.order_records
  set order_status = v_order_status,
      payment_status = v_payment_status,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'refundedAmount', p_refund_amount,
        'refundVerifiedAt', now(),
        'inventoryReturnStatus', 'Awaiting Inspection'
      ),
      updated_at = now()
  where id = p_order_id;

  update public.orders
  set status = v_order_status,
      raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
        'status', v_order_status,
        'orderStatus', v_order_status,
        'paymentStatus', v_payment_status,
        'refundedAmount', p_refund_amount,
        'inventoryReturnStatus', 'Awaiting Inspection'
      )
  where id = p_order_id;

  update public.payment_attempts
  set status = v_payment_status,
      payload = coalesce(payload, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb),
      updated_at = now()
  where order_id = p_order_id
    and provider = p_provider
    and (provider_transaction_id = nullif(p_provider_transaction_id, '') or nullif(p_provider_transaction_id, '') is null);

  perform public.nixp_order_event(
    p_order_id,
    case when p_full_refund then 'refund_completed' else 'partial_refund_completed' end,
    'Payment Provider',
    case when p_full_refund then 'Full refund verified by payment provider.' else 'Partial refund verified by payment provider.' end,
    jsonb_build_object('provider', p_provider, 'refundAmount', p_refund_amount, 'inventoryReturnStatus', 'Awaiting Inspection')
  );

  return jsonb_build_object(
    'id', p_order_id,
    'orderStatus', v_order_status,
    'paymentStatus', v_payment_status,
    'refundAmount', p_refund_amount,
    'inventoryReturnStatus', 'Awaiting Inspection'
  );
end;
$$;

revoke all on function public.apply_verified_refund(text, text, text, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_refund(text, text, text, integer, boolean, jsonb) to service_role;

create or replace function public.merge_midtrans_payment_attempt(
  p_order_id text,
  p_status text,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if trim(coalesce(p_order_id, '')) !~ '^order-[A-Za-z0-9_-]{8,96}$' then
    raise exception 'INVALID_ORDER_ID';
  end if;

  update public.payment_attempts
  set status = p_status,
      payload = coalesce(payload, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb),
      updated_at = now()
  where provider = 'Midtrans'
    and provider_order_id = trim(p_order_id);

  if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.merge_midtrans_payment_attempt(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.merge_midtrans_payment_attempt(text, text, jsonb) to service_role;

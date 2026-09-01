-- Payment-session creation is a two-system operation: PostgreSQL reserves the
-- order, then Midtrans creates the Snap session. Claim the work in PostgreSQL
-- first so duplicate customer clicks can never create competing provider calls.
create or replace function public.claim_midtrans_payment_session(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.order_records%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_payload jsonb;
begin
  if trim(coalesce(p_order_id, '')) !~ '^order-[A-Za-z0-9_-]{8,96}$' then
    raise exception 'INVALID_ORDER_ID';
  end if;

  select * into v_order
  from public.order_records
  where id = trim(p_order_id)
  for update;

  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.order_status <> 'Active' or v_order.payment_status <> 'Pending' then
    raise exception 'ORDER_NOT_AWAITING_PAYMENT';
  end if;
  if v_order.payment_expires_at <= now() then raise exception 'ORDER_PAYMENT_EXPIRED'; end if;

  insert into public.payment_attempts (
    order_id, provider, provider_order_id, status, amount, payload
  ) values (
    v_order.id, 'Midtrans', v_order.id, 'Creating', v_order.grand_total,
    jsonb_build_object('sessionClaimedAt', now())
  ) on conflict (provider, provider_order_id) do nothing
  returning * into v_attempt;

  if found then
    return jsonb_build_object('action', 'create', 'expiresAt', v_order.payment_expires_at);
  end if;

  select * into v_attempt
  from public.payment_attempts
  where provider = 'Midtrans' and provider_order_id = v_order.id
  for update;
  v_payload := coalesce(v_attempt.payload, '{}'::jsonb);

  if nullif(v_payload->>'token', '') is not null
    and nullif(v_payload->>'redirectUrl', '') is not null then
    return jsonb_build_object(
      'action', 'reuse',
      'token', v_payload->>'token',
      'redirectUrl', v_payload->>'redirectUrl',
      'expiresAt', v_order.payment_expires_at
    );
  end if;

  -- A second browser click waits for the first serverless invocation instead
  -- of sending another Snap create request for the same NIXP order.
  if v_attempt.status = 'Creating' and v_attempt.updated_at > now() - interval '30 seconds' then
    return jsonb_build_object('action', 'wait', 'expiresAt', v_order.payment_expires_at);
  end if;

  update public.payment_attempts
  set status = 'Creating',
      payload = (v_payload - 'error') || jsonb_build_object('sessionClaimedAt', now()),
      updated_at = now()
  where id = v_attempt.id;

  return jsonb_build_object('action', 'recover', 'expiresAt', v_order.payment_expires_at);
end;
$$;

-- Queueing is intentionally separate from claiming delivery. Webhooks only
-- persist the notification; a background worker performs the network send.
create or replace function public.queue_notification_outbox(
  p_idempotency_key text,
  p_recipient text,
  p_reply_to text,
  p_subject text,
  p_text_body text,
  p_html_body text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.notification_outbox%rowtype;
begin
  insert into public.notification_outbox (
    idempotency_key, recipient, reply_to, subject, text_body, html_body
  ) values (
    left(trim(p_idempotency_key), 240), left(trim(p_recipient), 254),
    nullif(left(trim(coalesce(p_reply_to, '')), 254), ''), left(p_subject, 500),
    p_text_body, p_html_body
  ) on conflict (idempotency_key) do nothing;

  select * into v_row
  from public.notification_outbox
  where idempotency_key = left(trim(p_idempotency_key), 240);

  if not found then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
  return jsonb_build_object('queued', v_row.status <> 'Sent', 'status', v_row.status);
end;
$$;

revoke all on function public.claim_midtrans_payment_session(text) from public, anon, authenticated;
revoke all on function public.queue_notification_outbox(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_midtrans_payment_session(text) to service_role;
grant execute on function public.queue_notification_outbox(text, text, text, text, text, text) to service_role;

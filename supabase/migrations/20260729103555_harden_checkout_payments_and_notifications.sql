-- Commerce hardening: preserve order retries, bound anonymous checkout abuse,
-- and make transactional email and webhook processing durable.

create table if not exists public.commerce_rate_limits (
  scope text not null,
  subject text not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, subject)
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  channel text not null default 'email' check (channel = 'email'),
  recipient text not null,
  reply_to text,
  subject text not null,
  text_body text not null,
  html_body text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Sending', 'Sent', 'Failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.webhook_receipts
  add column if not exists status text not null default 'Received',
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.commerce_rate_limits enable row level security;
alter table public.notification_outbox enable row level security;

create index if not exists notification_outbox_due_idx
  on public.notification_outbox (status, next_attempt_at);

create or replace function public.consume_commerce_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.commerce_rate_limits%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'INVALID_RATE_LIMIT';
  end if;

  select * into v_row
  from public.commerce_rate_limits
  where scope = left(trim(p_scope), 80)
    and subject = left(trim(p_subject), 256)
  for update;

  if not found then
    insert into public.commerce_rate_limits (scope, subject, attempts)
    values (left(trim(p_scope), 80), left(trim(p_subject), 256), 1);
    return true;
  end if;

  if v_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    update public.commerce_rate_limits
    set window_started_at = now(), attempts = 1, updated_at = now()
    where scope = v_row.scope and subject = v_row.subject;
    return true;
  end if;

  if v_row.attempts >= p_limit then
    return false;
  end if;

  update public.commerce_rate_limits
  set attempts = attempts + 1, updated_at = now()
  where scope = v_row.scope and subject = v_row.subject;
  return true;
end;
$$;

create or replace function public.claim_notification_outbox(
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
    left(trim(p_idempotency_key), 240), left(trim(p_recipient), 254), nullif(left(trim(coalesce(p_reply_to, '')), 254), ''),
    left(p_subject, 500), p_text_body, p_html_body
  ) on conflict (idempotency_key) do nothing;

  select * into v_row
  from public.notification_outbox
  where idempotency_key = left(trim(p_idempotency_key), 240)
  for update;

  if v_row.status = 'Sent' then
    return jsonb_build_object('shouldSend', false, 'status', 'Sent');
  end if;

  if v_row.status = 'Sending' and v_row.updated_at > now() - interval '5 minutes' then
    return jsonb_build_object('shouldSend', false, 'status', 'Sending');
  end if;

  if v_row.next_attempt_at > now() then
    return jsonb_build_object('shouldSend', false, 'status', v_row.status, 'nextAttemptAt', v_row.next_attempt_at);
  end if;

  update public.notification_outbox
  set status = 'Sending', attempts = attempts + 1, updated_at = now(), last_error = null
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'shouldSend', true, 'idempotencyKey', v_row.idempotency_key, 'recipient', v_row.recipient,
    'replyTo', v_row.reply_to, 'subject', v_row.subject, 'text', v_row.text_body, 'html', v_row.html_body
  );
end;
$$;

create or replace function public.complete_notification_outbox(
  p_idempotency_key text,
  p_delivered boolean,
  p_provider_message_id text default null,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.notification_outbox%rowtype;
begin
  update public.notification_outbox
  set status = case when p_delivered then 'Sent' else 'Failed' end,
      provider_message_id = case when p_delivered then nullif(trim(coalesce(p_provider_message_id, '')), '') else provider_message_id end,
      sent_at = case when p_delivered then now() else sent_at end,
      last_error = case when p_delivered then null else left(coalesce(p_error, 'Notification delivery failed.'), 2000) end,
      next_attempt_at = case when p_delivered then now() else now() + make_interval(secs => least(3600, 60 * power(2, greatest(attempts - 1, 0))::integer)) end,
      updated_at = now()
  where idempotency_key = left(trim(p_idempotency_key), 240)
  returning * into v_row;

  if not found then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
  return jsonb_build_object('status', v_row.status, 'attempts', v_row.attempts, 'nextAttemptAt', v_row.next_attempt_at);
end;
$$;

create or replace function public.claim_due_notification_outbox(p_limit integer default 20)
returns table (idempotency_key text, recipient text, reply_to text, subject text, text_body text, html_body text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select id
    from public.notification_outbox
    where status in ('Pending', 'Failed') and next_attempt_at <= now()
    order by created_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), claimed as (
    update public.notification_outbox outbox
    set status = 'Sending', attempts = attempts + 1, updated_at = now(), last_error = null
    from due
    where outbox.id = due.id
    returning outbox.*
  )
  select claimed.idempotency_key, claimed.recipient, claimed.reply_to, claimed.subject, claimed.text_body, claimed.html_body
  from claimed;
end;
$$;

create or replace function public.claim_webhook_receipt(
  p_provider text,
  p_event_key text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.webhook_receipts%rowtype;
begin
  insert into public.webhook_receipts (provider, event_key, payload, status, attempts, processed_at, updated_at)
  values (left(trim(p_provider), 80), left(trim(p_event_key), 240), coalesce(p_payload, '{}'::jsonb), 'Processing', 1, null, now())
  on conflict (provider, event_key) do nothing
  returning * into v_row;

  if found then return jsonb_build_object('shouldProcess', true); end if;

  select * into v_row
  from public.webhook_receipts
  where provider = left(trim(p_provider), 80) and event_key = left(trim(p_event_key), 240)
  for update;

  if v_row.status = 'Processed' then return jsonb_build_object('shouldProcess', false, 'status', 'Processed'); end if;
  if v_row.status = 'Processing' and v_row.updated_at > now() - interval '5 minutes' then
    return jsonb_build_object('shouldProcess', false, 'status', 'Processing');
  end if;

  update public.webhook_receipts
  set status = 'Processing', attempts = attempts + 1, payload = coalesce(p_payload, payload), last_error = null, updated_at = now()
  where id = v_row.id;
  return jsonb_build_object('shouldProcess', true);
end;
$$;

create or replace function public.complete_webhook_receipt(
  p_provider text,
  p_event_key text,
  p_processed boolean,
  p_error text default null
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.webhook_receipts
  set status = case when p_processed then 'Processed' else 'Failed' end,
      processed_at = case when p_processed then now() else processed_at end,
      last_error = case when p_processed then null else left(coalesce(p_error, 'Webhook processing failed.'), 2000) end,
      updated_at = now()
  where provider = left(trim(p_provider), 80) and event_key = left(trim(p_event_key), 240);
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
      'The two-hour payment window ended before payment was verified. Reserved stock has been released.',
    '<h1>NIXP order expired</h1><p><strong>Order:</strong> ' || order_record.public_reference ||
      '<br>The two-hour payment window ended before payment was verified. Reserved stock has been released.</p>'
  from public.order_records order_record
  where order_record.payment_status = 'Expired'
    and nullif(trim(order_record.customer->>'email'), '') is not null
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.nixp_commerce_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_expired jsonb; v_queued integer;
begin
  v_expired := public.release_expired_orders();
  v_queued := public.queue_expired_order_notifications();
  delete from public.commerce_rate_limits where updated_at < now() - interval '2 days';
  return jsonb_build_object('expired', v_expired, 'queuedExpiryEmails', v_queued);
end;
$$;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'nixp-expire-pending-orders';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('nixp-expire-pending-orders', '*/5 * * * *', $cron$select public.nixp_commerce_maintenance();$cron$);
end;
$$;

revoke all on table public.commerce_rate_limits, public.notification_outbox from anon, authenticated;
revoke all on function public.consume_commerce_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_notification_outbox(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_notification_outbox(text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.claim_due_notification_outbox(integer) from public, anon, authenticated;
revoke all on function public.claim_webhook_receipt(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_webhook_receipt(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.queue_expired_order_notifications() from public, anon, authenticated;
revoke all on function public.nixp_commerce_maintenance() from public, anon, authenticated;
grant execute on function public.consume_commerce_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.claim_notification_outbox(text, text, text, text, text, text) to service_role;
grant execute on function public.complete_notification_outbox(text, boolean, text, text) to service_role;
grant execute on function public.claim_due_notification_outbox(integer) to service_role;
grant execute on function public.claim_webhook_receipt(text, text, jsonb) to service_role;
grant execute on function public.complete_webhook_receipt(text, text, boolean, text) to service_role;
grant execute on function public.queue_expired_order_notifications() to service_role;
grant execute on function public.nixp_commerce_maintenance() to service_role;

-- A serverless invocation can end after claiming an email but before it marks
-- the provider result. Recover that message after a short lease rather than
-- letting it remain Sending forever.

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
    where (
      status in ('Pending', 'Failed') and next_attempt_at <= now()
    ) or (
      status = 'Sending' and updated_at <= now() - interval '5 minutes'
    )
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

revoke all on function public.claim_due_notification_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notification_outbox(integer) to service_role;

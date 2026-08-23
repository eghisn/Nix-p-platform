-- Internal queue and abuse-control data is available only through service-role
-- functions. Explicit deny policies document and enforce that boundary.

drop policy if exists "No direct access to commerce rate limits" on public.commerce_rate_limits;
create policy "No direct access to commerce rate limits"
  on public.commerce_rate_limits
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "No direct access to notification outbox" on public.notification_outbox;
create policy "No direct access to notification outbox"
  on public.notification_outbox
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

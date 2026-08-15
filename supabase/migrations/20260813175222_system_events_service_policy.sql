create policy system_events_service_role_all
  on public.system_events
  for all
  to service_role
  using (true)
  with check (true);

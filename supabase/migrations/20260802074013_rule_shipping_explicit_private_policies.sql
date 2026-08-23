create policy "shipping_settings_server_only"
  on public.shipping_settings
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "shipping_rates_server_only"
  on public.shipping_rates
  for all
  to anon, authenticated
  using (false)
  with check (false);

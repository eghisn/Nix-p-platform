create index if not exists shipping_destinations_jne_destination_id_idx on public.shipping_destinations (jne_destination_id);
create index if not exists shipping_rates_destination_id_idx on public.shipping_rates (destination_id);
create index if not exists shipping_rates_shipping_service_id_idx on public.shipping_rates (shipping_service_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'jne_destinations', 'shipping_destinations', 'shipping_services', 'shipping_rate_versions',
    'shipping_rates', 'jne_tariff_cache', 'shipping_quote_sessions', 'shipping_sync_jobs',
    'shipping_source_events', 'shipping_validation_runs'
  ] loop
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_server_only', table_name);
  end loop;
end $$;

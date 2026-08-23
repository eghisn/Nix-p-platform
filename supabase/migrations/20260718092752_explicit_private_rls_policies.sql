-- These tables are deliberately server-only. Explicit false policies make that
-- intent visible to the database advisor while RLS and revoked grants prevent
-- browser clients from reading or mutating private business data.
do $$
declare t text;
begin
  foreach t in array array[
    'cashflow','finance_state','inventory','orders','requests','store_backups',
    'order_records','order_lines','inventory_reservations','payment_attempts',
    'shipping_quotes','shipments','order_events','webhook_receipts','return_requests'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Private server access only', t);
    execute format('create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', 'Private server access only', t);
  end loop;
end;
$$;

create or replace function public.set_finance_state_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists "Public can read product images" on storage.objects;

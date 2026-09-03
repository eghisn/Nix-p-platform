-- Prevent a zero-price public product from reserving stock for a payment that
-- Midtrans cannot accept. Raising inside the checkout transaction rolls back
-- every reservation and product quantity update made by that order.

create or replace function public.reject_unpriced_order_line()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.unit_price <= 0 or new.line_total <= 0 then
    raise exception 'ITEM_UNAVAILABLE: PRICE_NOT_SET';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_unpriced_order_line on public.order_lines;
create trigger reject_unpriced_order_line
before insert or update of unit_price, line_total on public.order_lines
for each row execute function public.reject_unpriced_order_line();

revoke all on function public.reject_unpriced_order_line() from public, anon, authenticated;
grant execute on function public.reject_unpriced_order_line() to service_role;

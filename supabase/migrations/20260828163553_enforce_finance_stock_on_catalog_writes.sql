-- Keep the currently deployed synchronizer from restoring reserved stock
-- while the application deployment catches up. Products without a Finance SKU
-- keep their existing quantity behavior.
create or replace function public.enforce_product_stock_from_finance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_finance_qty integer;
  v_reserved integer;
  v_sold integer;
begin
  if nullif(trim(coalesce(new.sku, '')), '') is null then return new; end if;
  select state into v_state from public.finance_state where key = 'main';
  if not found then return new; end if;
  v_finance_qty := public.finance_inventory_quantity(v_state, new.sku);
  if v_finance_qty is null then return new; end if;

  select coalesce(sum(quantity), 0)::integer into v_reserved
  from public.inventory_reservations
  where product_id = new.id and status = 'Active';
  v_sold := case
    when coalesce(new.raw->'stock'->>'sold', '') ~ '^-?[0-9]+$' then greatest(0, (new.raw->'stock'->>'sold')::integer)
    else 0
  end;
  new.qty := greatest(0, v_finance_qty - v_reserved);
  new.raw := jsonb_set(
    jsonb_set(coalesce(new.raw, '{}'::jsonb), '{qty}', to_jsonb(new.qty), true),
    '{stock}', jsonb_build_object('available', new.qty, 'reserved', v_reserved, 'sold', v_sold), true
  );
  return new;
end;
$$;

drop trigger if exists enforce_product_stock_from_finance on public.products;
create trigger enforce_product_stock_from_finance
before insert or update of sku, qty on public.products
for each row execute function public.enforce_product_stock_from_finance();

revoke all on function public.enforce_product_stock_from_finance() from public, anon, authenticated;

create or replace function public.marketing_dashboard_contacts_summary()
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with totals as (
    select count(*)::integer as known_customers,
      count(*) filter (where orders > 1)::integer as returning_customers
    from public.marketing_customer_metrics
  ),
  contacts as (
    select email, customer_name, orders, paid_orders, lifetime_sales, last_order_at
    from public.marketing_customer_metrics
    order by last_order_at desc nulls last, email asc
    limit 500
  )
  select jsonb_build_object(
    'knownCustomers', coalesce((select known_customers from totals), 0),
    'returningCustomers', coalesce((select returning_customers from totals), 0),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object(
      'name', customer_name, 'email', email, 'orders', orders, 'paidOrders', paid_orders,
      'sales', lifetime_sales, 'lastOrder', last_order_at, 'marketingConsent', false
    ) order by last_order_at desc nulls last, email asc) from contacts), '[]'::jsonb)
  );
$$;

revoke all on function public.marketing_dashboard_contacts_summary() from public, anon, authenticated;
grant execute on function public.marketing_dashboard_contacts_summary() to service_role;

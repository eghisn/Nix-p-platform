create or replace function public.marketing_dashboard_products(p_from_date date, p_to_date date)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with products as (
    select
      metric.product_id as id,
      coalesce(nullif(max(metric.title), ''), nullif(max(product.title), ''), metric.product_id) as title,
      coalesce(nullif(max(metric.artist), ''), nullif(max(product.artist), ''), '') as artist,
      coalesce(sum(metric.product_views + metric.product_clicks), 0)::integer as views,
      coalesce(sum(metric.add_to_cart_count), 0)::integer as added,
      coalesce(sum(metric.paid_orders), 0)::integer as orders,
      coalesce(sum(metric.units), 0)::integer as units,
      coalesce(sum(metric.gross_sales), 0)::integer as sales
    from public.marketing_product_metrics metric
    left join public.products product on product.id = metric.product_id
    where metric.metric_date between p_from_date and p_to_date
    group by metric.product_id
    order by coalesce(sum(metric.gross_sales), 0) desc, coalesce(sum(metric.product_views + metric.product_clicks), 0) desc, metric.product_id asc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'artist', artist, 'views', views, 'added', added, 'orders', orders, 'units', units, 'sales', sales) order by sales desc, views desc, id asc), '[]'::jsonb)
  from products;
$$;

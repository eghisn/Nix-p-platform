-- Durable analytics rollups. Raw marketing_events and commerce records remain
-- the source of truth; these tables only make dashboard reads compact and safe
-- once the catalogue grows beyond the former REST response limits.

alter table public.marketing_daily_metrics
  add column if not exists product_view_sessions integer not null default 0 check (product_view_sessions >= 0),
  add column if not exists add_to_cart_sessions integer not null default 0 check (add_to_cart_sessions >= 0),
  add column if not exists checkout_sessions integer not null default 0 check (checkout_sessions >= 0),
  add column if not exists orders_expired integer not null default 0 check (orders_expired >= 0),
  add column if not exists orders_cancelled integer not null default 0 check (orders_cancelled >= 0),
  add column if not exists refund_amount integer not null default 0 check (refund_amount >= 0);

alter table public.marketing_campaign_sources
  add column if not exists metric_date date,
  add column if not exists product_views integer not null default 0 check (product_views >= 0),
  add column if not exists product_clicks integer not null default 0 check (product_clicks >= 0),
  add column if not exists add_to_cart_count integer not null default 0 check (add_to_cart_count >= 0);

update public.marketing_campaign_sources
set metric_date = (last_seen_at at time zone 'Asia/Jakarta')::date
where metric_date is null;

alter table public.marketing_campaign_sources
  alter column metric_date set not null;

alter table public.marketing_campaign_sources
  drop constraint if exists marketing_campaign_sources_source_medium_campaign_key;

create unique index if not exists marketing_campaign_sources_date_key
  on public.marketing_campaign_sources (metric_date, source, medium, campaign);

create index if not exists marketing_campaign_sources_metric_date_idx
  on public.marketing_campaign_sources (metric_date desc);

create table if not exists public.marketing_session_activity (
  metric_date date not null,
  anonymous_session_id uuid not null,
  source text not null default 'direct',
  medium text not null default '',
  campaign text not null default '',
  country_code char(2),
  device_type text not null default 'unknown' check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),
  page_views integer not null default 0 check (page_views >= 0),
  product_views integer not null default 0 check (product_views >= 0),
  product_clicks integer not null default 0 check (product_clicks >= 0),
  add_to_cart_count integer not null default 0 check (add_to_cart_count >= 0),
  checkout_starts integer not null default 0 check (checkout_starts >= 0),
  first_occurred_at timestamptz not null,
  last_occurred_at timestamptz not null,
  generated_at timestamptz not null default now(),
  primary key (metric_date, anonymous_session_id)
);

create index if not exists marketing_session_activity_date_source_idx
  on public.marketing_session_activity (metric_date desc, source, medium, campaign);

create table if not exists public.marketing_product_metrics (
  metric_date date not null,
  product_id text not null,
  title text not null default '',
  artist text not null default '',
  product_views integer not null default 0 check (product_views >= 0),
  product_clicks integer not null default 0 check (product_clicks >= 0),
  add_to_cart_count integer not null default 0 check (add_to_cart_count >= 0),
  paid_orders integer not null default 0 check (paid_orders >= 0),
  units integer not null default 0 check (units >= 0),
  gross_sales integer not null default 0 check (gross_sales >= 0),
  generated_at timestamptz not null default now(),
  primary key (metric_date, product_id)
);

create index if not exists marketing_product_metrics_date_idx
  on public.marketing_product_metrics (metric_date desc, gross_sales desc, product_views desc);

create table if not exists public.marketing_customer_metrics (
  email text primary key,
  customer_name text not null default 'Customer',
  orders integer not null default 0 check (orders >= 0),
  paid_orders integer not null default 0 check (paid_orders >= 0),
  lifetime_sales integer not null default 0 check (lifetime_sales >= 0),
  last_order_at timestamptz,
  generated_at timestamptz not null default now()
);

create index if not exists marketing_customer_metrics_last_order_idx
  on public.marketing_customer_metrics (last_order_at desc);

alter table public.marketing_session_activity enable row level security;
alter table public.marketing_product_metrics enable row level security;
alter table public.marketing_customer_metrics enable row level security;

revoke all on table public.marketing_session_activity, public.marketing_product_metrics, public.marketing_customer_metrics from public, anon, authenticated;
grant select, insert, update, delete on table public.marketing_session_activity, public.marketing_product_metrics, public.marketing_customer_metrics to service_role;

create policy marketing_session_activity_service_role_all
  on public.marketing_session_activity for all to service_role using (true) with check (true);
create policy marketing_product_metrics_service_role_all
  on public.marketing_product_metrics for all to service_role using (true) with check (true);
create policy marketing_customer_metrics_service_role_all
  on public.marketing_customer_metrics for all to service_role using (true) with check (true);

create or replace function public.refresh_marketing_rollups(
  p_from_date date default ((now() at time zone 'Asia/Jakarta')::date - 7),
  p_to_date date default (now() at time zone 'Asia/Jakarta')::date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_from timestamptz;
  v_event_to timestamptz;
begin
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception 'Invalid marketing rollup date range.';
  end if;
  if p_to_date - p_from_date > 400 then
    raise exception 'Marketing rollup date range cannot exceed 400 days.';
  end if;

  v_event_from := p_from_date::timestamp at time zone 'Asia/Jakarta';
  v_event_to := (p_to_date + 1)::timestamp at time zone 'Asia/Jakarta';

  -- Replacing a bounded date range makes the refresh idempotent: a retry
  -- produces the same result and never adds a second copy of a metric.
  delete from public.marketing_campaign_sources where metric_date between p_from_date and p_to_date;
  delete from public.marketing_product_metrics where metric_date between p_from_date and p_to_date;
  delete from public.marketing_session_activity where metric_date between p_from_date and p_to_date;
  delete from public.marketing_daily_metrics where metric_date between p_from_date and p_to_date;

  insert into public.marketing_session_activity (
    metric_date, anonymous_session_id, source, medium, campaign, country_code, device_type,
    page_views, product_views, product_clicks, add_to_cart_count, checkout_starts,
    first_occurred_at, last_occurred_at, generated_at
  )
  select
    (occurred_at at time zone 'Asia/Jakarta')::date as metric_date,
    anonymous_session_id,
    coalesce((array_agg(nullif(btrim(source), '') order by occurred_at) filter (where nullif(btrim(source), '') is not null))[1], 'direct'),
    coalesce((array_agg(nullif(btrim(medium), '') order by occurred_at) filter (where nullif(btrim(medium), '') is not null))[1], ''),
    coalesce((array_agg(nullif(btrim(campaign), '') order by occurred_at) filter (where nullif(btrim(campaign), '') is not null))[1], ''),
    (array_agg(country_code order by occurred_at) filter (where country_code is not null))[1],
    coalesce((array_agg(device_type order by occurred_at) filter (where device_type is not null))[1], 'unknown'),
    count(*) filter (where event_type = 'page_view')::integer,
    count(*) filter (where event_type = 'product_view')::integer,
    count(*) filter (where event_type = 'product_click')::integer,
    count(*) filter (where event_type = 'add_to_cart')::integer,
    count(*) filter (where event_type = 'checkout_started')::integer,
    min(occurred_at),
    max(occurred_at),
    now()
  from public.marketing_events
  where occurred_at >= v_event_from and occurred_at < v_event_to
  group by (occurred_at at time zone 'Asia/Jakarta')::date, anonymous_session_id;

  insert into public.marketing_product_metrics (
    metric_date, product_id, title, artist, product_views, product_clicks, add_to_cart_count,
    paid_orders, units, gross_sales, generated_at
  )
  with event_metrics as (
    select
      (occurred_at at time zone 'Asia/Jakarta')::date as metric_date,
      product_id,
      count(*) filter (where event_type = 'product_view')::integer as product_views,
      count(*) filter (where event_type = 'product_click')::integer as product_clicks,
      count(*) filter (where event_type = 'add_to_cart')::integer as add_to_cart_count
    from public.marketing_events
    where occurred_at >= v_event_from and occurred_at < v_event_to and nullif(btrim(product_id), '') is not null
    group by (occurred_at at time zone 'Asia/Jakarta')::date, product_id
  ),
  sales_metrics as (
    select
      (coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) at time zone 'Asia/Jakarta')::date as metric_date,
      coalesce(nullif(btrim(order_line.product_id), ''), nullif(btrim(order_line.sku), '')) as product_id,
      max(coalesce(order_line.title, '')) as title,
      max(coalesce(order_line.artist, '')) as artist,
      count(distinct order_record.id)::integer as paid_orders,
      coalesce(sum(order_line.quantity), 0)::integer as units,
      coalesce(sum(order_line.line_total), 0)::integer as gross_sales
    from public.order_records order_record
    join public.order_lines order_line on order_line.order_id = order_record.id
    where coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) >= v_event_from
      and coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) < v_event_to
      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
      and coalesce(nullif(btrim(order_line.product_id), ''), nullif(btrim(order_line.sku), '')) is not null
    group by (coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) at time zone 'Asia/Jakarta')::date,
      coalesce(nullif(btrim(order_line.product_id), ''), nullif(btrim(order_line.sku), ''))
  )
  select
    coalesce(event_metrics.metric_date, sales_metrics.metric_date),
    coalesce(event_metrics.product_id, sales_metrics.product_id),
    coalesce(sales_metrics.title, ''),
    coalesce(sales_metrics.artist, ''),
    coalesce(event_metrics.product_views, 0),
    coalesce(event_metrics.product_clicks, 0),
    coalesce(event_metrics.add_to_cart_count, 0),
    coalesce(sales_metrics.paid_orders, 0),
    coalesce(sales_metrics.units, 0),
    coalesce(sales_metrics.gross_sales, 0),
    now()
  from event_metrics
  full outer join sales_metrics on sales_metrics.metric_date = event_metrics.metric_date and sales_metrics.product_id = event_metrics.product_id;

  insert into public.marketing_daily_metrics (
    metric_date, sessions, unique_sessions, page_views, product_views, product_clicks,
    add_to_cart_count, checkout_starts, product_view_sessions, add_to_cart_sessions,
    checkout_sessions, orders_paid, gross_sales, refunds, refund_amount, net_sales,
    orders_expired, orders_cancelled, generated_at
  )
  with event_rollups as (
    select
      metric_date,
      count(*)::integer as sessions,
      count(*)::integer as unique_sessions,
      coalesce(sum(page_views), 0)::integer as page_views,
      coalesce(sum(product_views), 0)::integer as product_views,
      coalesce(sum(product_clicks), 0)::integer as product_clicks,
      coalesce(sum(add_to_cart_count), 0)::integer as add_to_cart_count,
      coalesce(sum(checkout_starts), 0)::integer as checkout_starts,
      count(*) filter (where product_views > 0)::integer as product_view_sessions,
      count(*) filter (where add_to_cart_count > 0)::integer as add_to_cart_sessions,
      count(*) filter (where checkout_starts > 0)::integer as checkout_sessions
    from public.marketing_session_activity
    where metric_date between p_from_date and p_to_date
    group by metric_date
  ),
  paid_rollups as (
    select
      (coalesce(paid_at, updated_at, created_at) at time zone 'Asia/Jakarta')::date as metric_date,
      count(*)::integer as orders_paid,
      coalesce(sum(grand_total), 0)::integer as gross_sales
    from public.order_records
    where coalesce(paid_at, updated_at, created_at) >= v_event_from
      and coalesce(paid_at, updated_at, created_at) < v_event_to
      and (paid_at is not null or lower(coalesce(payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
    group by (coalesce(paid_at, updated_at, created_at) at time zone 'Asia/Jakarta')::date
  ),
  refund_rollups as (
    select
      (coalesce(nullif(metadata->>'refundVerifiedAt', '')::timestamptz, updated_at, created_at) at time zone 'Asia/Jakarta')::date as metric_date,
      count(*)::integer as refunds,
      coalesce(sum(
        case
          when lower(coalesce(payment_status, '')) = 'refunded' then grand_total
          when coalesce(metadata->>'refundedAmount', '') ~ '^[0-9]+$' then least(grand_total, greatest(0, (metadata->>'refundedAmount')::integer))
          else 0
        end
      ), 0)::integer as refund_amount
    from public.order_records
    where coalesce(nullif(metadata->>'refundVerifiedAt', '')::timestamptz, updated_at, created_at) >= v_event_from
      and coalesce(nullif(metadata->>'refundVerifiedAt', '')::timestamptz, updated_at, created_at) < v_event_to
      and lower(replace(coalesce(payment_status, ''), ' ', '_')) in ('refunded', 'partial_refund', 'partially_refunded')
    group by (coalesce(nullif(metadata->>'refundVerifiedAt', '')::timestamptz, updated_at, created_at) at time zone 'Asia/Jakarta')::date
  ),
  outcome_rollups as (
    select
      (coalesce(updated_at, created_at) at time zone 'Asia/Jakarta')::date as metric_date,
      count(*) filter (where lower(coalesce(order_status, '')) like 'cancel%')::integer as orders_cancelled,
      count(*) filter (where lower(coalesce(order_status, '')) like 'expir%' or lower(coalesce(payment_status, '')) like 'expir%')::integer as orders_expired
    from public.order_records
    where coalesce(updated_at, created_at) >= v_event_from and coalesce(updated_at, created_at) < v_event_to
    group by (coalesce(updated_at, created_at) at time zone 'Asia/Jakarta')::date
  ),
  dates as (
    select metric_date from event_rollups
    union select metric_date from paid_rollups
    union select metric_date from refund_rollups
    union select metric_date from outcome_rollups
  )
  select
    dates.metric_date,
    coalesce(event_rollups.sessions, 0), coalesce(event_rollups.unique_sessions, 0),
    coalesce(event_rollups.page_views, 0), coalesce(event_rollups.product_views, 0), coalesce(event_rollups.product_clicks, 0),
    coalesce(event_rollups.add_to_cart_count, 0), coalesce(event_rollups.checkout_starts, 0),
    coalesce(event_rollups.product_view_sessions, 0), coalesce(event_rollups.add_to_cart_sessions, 0), coalesce(event_rollups.checkout_sessions, 0),
    coalesce(paid_rollups.orders_paid, 0), coalesce(paid_rollups.gross_sales, 0),
    coalesce(refund_rollups.refunds, 0), coalesce(refund_rollups.refund_amount, 0),
    coalesce(paid_rollups.gross_sales, 0) - coalesce(refund_rollups.refund_amount, 0),
    coalesce(outcome_rollups.orders_expired, 0), coalesce(outcome_rollups.orders_cancelled, 0), now()
  from dates
  left join event_rollups using (metric_date)
  left join paid_rollups using (metric_date)
  left join refund_rollups using (metric_date)
  left join outcome_rollups using (metric_date);

  insert into public.marketing_campaign_sources (
    metric_date, source, medium, campaign, first_seen_at, last_seen_at, sessions, page_views,
    checkout_starts, product_views, product_clicks, add_to_cart_count
  )
  select
    metric_date, source, medium, campaign, min(first_occurred_at), max(last_occurred_at), count(*)::integer,
    coalesce(sum(page_views), 0)::integer, coalesce(sum(checkout_starts), 0)::integer,
    coalesce(sum(product_views), 0)::integer, coalesce(sum(product_clicks), 0)::integer, coalesce(sum(add_to_cart_count), 0)::integer
  from public.marketing_session_activity
  where metric_date between p_from_date and p_to_date
  group by metric_date, source, medium, campaign;

  delete from public.marketing_customer_metrics;
  insert into public.marketing_customer_metrics (email, customer_name, orders, paid_orders, lifetime_sales, last_order_at, generated_at)
  select
    lower(btrim(customer->>'email')) as email,
    coalesce(max(nullif(btrim(customer->>'name'), '')), 'Customer') as customer_name,
    count(*)::integer as orders,
    count(*) filter (where paid_at is not null or lower(coalesce(payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))::integer as paid_orders,
    coalesce(sum(grand_total) filter (where paid_at is not null or lower(coalesce(payment_status, '')) in ('paid', 'settlement', 'capture', 'completed')), 0)::integer as lifetime_sales,
    max(coalesce(paid_at, created_at)) as last_order_at,
    now()
  from public.order_records
  where nullif(btrim(customer->>'email'), '') is not null
  group by lower(btrim(customer->>'email'));

  return jsonb_build_object(
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'refreshedAt', now(),
    'dailyRows', (select count(*) from public.marketing_daily_metrics where metric_date between p_from_date and p_to_date),
    'sessionRows', (select count(*) from public.marketing_session_activity where metric_date between p_from_date and p_to_date)
  );
end;
$$;

create or replace function public.marketing_dashboard_session_summary(p_from_date date, p_to_date date)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with activity as materialized (
    select * from public.marketing_session_activity
    where metric_date between p_from_date and p_to_date
  ),
  totals as (
    select
      count(distinct anonymous_session_id)::integer as sessions,
      coalesce(sum(page_views), 0)::integer as page_views,
      coalesce(sum(product_views), 0)::integer as product_views,
      coalesce(sum(product_clicks), 0)::integer as product_clicks,
      coalesce(sum(add_to_cart_count), 0)::integer as add_to_cart_count,
      coalesce(sum(checkout_starts), 0)::integer as checkout_starts,
      count(distinct anonymous_session_id) filter (where product_views > 0)::integer as product_view_sessions,
      count(distinct anonymous_session_id) filter (where add_to_cart_count > 0)::integer as add_to_cart_sessions,
      count(distinct anonymous_session_id) filter (where checkout_starts > 0)::integer as checkout_sessions
    from activity
  ),
  countries as (
    select coalesce(nullif(country_code::text, ''), 'UNKNOWN') as name, sum(page_views + product_views + product_clicks + add_to_cart_count + checkout_starts)::integer as count
    from activity group by 1 order by 2 desc, 1 asc limit 20
  ),
  devices as (
    select coalesce(nullif(device_type, ''), 'unknown') as name, sum(page_views + product_views + product_clicks + add_to_cart_count + checkout_starts)::integer as count
    from activity group by 1 order by 2 desc, 1 asc limit 20
  ),
  sources as (
    select
      source, medium, campaign,
      count(distinct anonymous_session_id)::integer as sessions,
      coalesce(sum(product_views + product_clicks), 0)::integer as views,
      coalesce(sum(add_to_cart_count), 0)::integer as added
    from activity
    group by source, medium, campaign
    order by count(distinct anonymous_session_id) desc, source asc, campaign asc
    limit 50
  )
  select jsonb_build_object(
    'metrics', (select jsonb_build_object(
      'sessions', coalesce(sessions, 0), 'pageViews', coalesce(page_views, 0), 'productViews', coalesce(product_views, 0),
      'productClicks', coalesce(product_clicks, 0), 'addToCart', coalesce(add_to_cart_count, 0), 'checkoutStarted', coalesce(checkout_starts, 0),
      'productViewSessions', coalesce(product_view_sessions, 0), 'addToCartSessions', coalesce(add_to_cart_sessions, 0), 'checkoutSessions', coalesce(checkout_sessions, 0)
    ) from totals),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count, 'share', count::numeric / nullif((select sum(count) from countries), 0)) order by count desc, name asc) from countries), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count, 'share', count::numeric / nullif((select sum(count) from devices), 0)) order by count desc, name asc) from devices), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'medium', medium, 'campaign', campaign, 'sessions', sessions, 'views', views, 'added', added) order by sessions desc, source asc, campaign asc) from sources), '[]'::jsonb)
  );
$$;

create or replace function public.marketing_dashboard_products(p_from_date date, p_to_date date)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with products as (
    select
      product_id as id,
      coalesce(nullif(max(title), ''), product_id) as title,
      coalesce(nullif(max(artist), ''), '') as artist,
      coalesce(sum(product_views + product_clicks), 0)::integer as views,
      coalesce(sum(add_to_cart_count), 0)::integer as added,
      coalesce(sum(paid_orders), 0)::integer as orders,
      coalesce(sum(units), 0)::integer as units,
      coalesce(sum(gross_sales), 0)::integer as sales
    from public.marketing_product_metrics
    where metric_date between p_from_date and p_to_date
    group by product_id
    order by coalesce(sum(gross_sales), 0) desc, coalesce(sum(product_views + product_clicks), 0) desc, product_id asc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'artist', artist, 'views', views, 'added', added, 'orders', orders, 'units', units, 'sales', sales) order by sales desc, views desc, id asc), '[]'::jsonb)
  from products;
$$;

revoke all on function public.refresh_marketing_rollups(date, date) from public, anon, authenticated;
revoke all on function public.marketing_dashboard_session_summary(date, date) from public, anon, authenticated;
revoke all on function public.marketing_dashboard_products(date, date) from public, anon, authenticated;
grant execute on function public.refresh_marketing_rollups(date, date), public.marketing_dashboard_session_summary(date, date), public.marketing_dashboard_products(date, date) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'nixp-marketing-rollup-refresh';

select cron.schedule(
  'nixp-marketing-rollup-refresh',
  '*/15 * * * *',
  $$select public.refresh_marketing_rollups(((now() at time zone 'Asia/Jakarta')::date - 7), (now() at time zone 'Asia/Jakarta')::date);$$
);

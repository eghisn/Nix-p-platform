-- A private planning layer over consented website attribution. Content plans
-- contain no customer data; public analytics continue to remain pseudonymous.

create table if not exists public.marketing_content_plans (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  content_type text not null default 'Reel' check (content_type in ('Reel', 'Feed post', 'Carousel', 'Story', 'Other')),
  objective text not null default 'Store visits' check (objective in ('Awareness', 'Community', 'Store visits', 'Conversion')),
  status text not null default 'Planned' check (status in ('Planned', 'Published', 'Archived')),
  planned_at date,
  campaign text not null default '' check (char_length(campaign) <= 120),
  tracking_content text not null unique check (tracking_content ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  destination_path text not null default '/' check (left(destination_path, 1) = '/' and char_length(destination_path) <= 240),
  instagram_permalink text not null default '' check (char_length(instagram_permalink) <= 300),
  target_likes integer not null default 0 check (target_likes >= 0),
  target_comments integer not null default 0 check (target_comments >= 0),
  target_sessions integer not null default 0 check (target_sessions >= 0),
  target_carts integer not null default 0 check (target_carts >= 0),
  target_paid_orders integer not null default 0 check (target_paid_orders >= 0),
  target_revenue integer not null default 0 check (target_revenue >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_content_plans_status_date_idx
  on public.marketing_content_plans (status, planned_at desc nulls last, created_at desc);

alter table public.marketing_content_plans enable row level security;
revoke all on public.marketing_content_plans from public, anon, authenticated;
grant select, insert, update, delete on public.marketing_content_plans to service_role;

drop policy if exists marketing_content_plans_service_role_all on public.marketing_content_plans;
create policy marketing_content_plans_service_role_all
  on public.marketing_content_plans for all to service_role using (true) with check (true);

create or replace function public.marketing_dashboard_content_performance(p_from_date date, p_to_date date)
returns table (
  tracking_content text,
  sessions bigint,
  product_views bigint,
  carts bigint,
  checkouts bigint,
  paid_orders bigint,
  revenue bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with event_metrics as (
    select
      lower(btrim(content)) as tracking_content,
      count(distinct anonymous_session_id) as sessions,
      count(*) filter (where event_type = 'product_view') as product_views,
      count(*) filter (where event_type = 'add_to_cart') as carts,
      count(*) filter (where event_type = 'checkout_started') as checkouts
    from public.marketing_events
    where source = 'instagram'
      and nullif(btrim(content), '') is not null
      and occurred_at >= p_from_date::timestamp at time zone 'Asia/Jakarta'
      and occurred_at < (p_to_date + 1)::timestamp at time zone 'Asia/Jakarta'
    group by 1
  ), order_metrics as (
    select
      lower(btrim(order_record.metadata->'marketingAttribution'->>'content')) as tracking_content,
      count(*) as paid_orders,
      coalesce(sum(order_record.merchandise_total), 0)::bigint as revenue
    from public.order_records as order_record
    where order_record.payment_status = 'Paid'
      and coalesce(order_record.order_class, 'Customer') <> 'Test'
      and coalesce(lower(btrim(order_record.metadata->'marketingAttribution'->>'source')), '') = 'instagram'
      and nullif(btrim(order_record.metadata->'marketingAttribution'->>'content'), '') is not null
      and order_record.paid_at >= p_from_date::timestamp at time zone 'Asia/Jakarta'
      and order_record.paid_at < (p_to_date + 1)::timestamp at time zone 'Asia/Jakarta'
    group by 1
  )
  select
    coalesce(event_metrics.tracking_content, order_metrics.tracking_content) as tracking_content,
    coalesce(event_metrics.sessions, 0)::bigint,
    coalesce(event_metrics.product_views, 0)::bigint,
    coalesce(event_metrics.carts, 0)::bigint,
    coalesce(event_metrics.checkouts, 0)::bigint,
    coalesce(order_metrics.paid_orders, 0)::bigint,
    coalesce(order_metrics.revenue, 0)::bigint
  from event_metrics
  full outer join order_metrics using (tracking_content);
$$;

revoke all on function public.marketing_dashboard_content_performance(date, date) from public, anon, authenticated;
grant execute on function public.marketing_dashboard_content_performance(date, date) to service_role;

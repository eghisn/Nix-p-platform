-- Marketing reporting hardening. These changes are deliberately read-oriented:
-- order pricing, reservation, payment, and Finance ledger writes are untouched.

alter table public.marketing_events
  drop constraint if exists marketing_events_event_type_check;

alter table public.marketing_events
  add constraint marketing_events_event_type_check check (event_type in (
    'page_view', 'product_view', 'product_click', 'add_to_cart', 'cart_open', 'checkout_started',
    'request_item_submitted', 'offer_submitted', 'social_outbound_click'
  ));

-- Repair known historical aliases once, so old traffic does not remain split.
update public.marketing_events
set source = case lower(coalesce(source, ''))
  when 'instagram.com' then 'instagram'
  when 'www.instagram.com' then 'instagram'
  when 'm.instagram.com' then 'instagram'
  when 'l.instagram.com' then 'instagram'
  when 'tiktok.com' then 'tiktok'
  when 'www.tiktok.com' then 'tiktok'
  when 'vm.tiktok.com' then 'tiktok'
  when 'vt.tiktok.com' then 'tiktok'
  when 'facebook.com' then 'facebook'
  when 'www.facebook.com' then 'facebook'
  when 'l.facebook.com' then 'facebook'
  when 'youtube.com' then 'youtube'
  when 'www.youtube.com' then 'youtube'
  when 'youtu.be' then 'youtube'
  when 'twitter.com' then 'x'
  when 'www.twitter.com' then 'x'
  when 'x.com' then 'x'
  when 'www.x.com' then 'x'
  when 'nix-p.com' then 'direct'
  when 'www.nix-p.com' then 'direct'
  else lower(coalesce(source, 'direct'))
end;

-- Captures first-touch, consented, pseudonymous attribution after the order
-- exists. It never accepts customer identity and cannot overwrite an existing
-- attribution value on an order retry.
create or replace function public.attach_order_marketing_attribution(
  p_order_id text,
  p_attribution jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_metadata jsonb;
  v_session_id text;
  v_source text;
  v_medium text;
  v_campaign text;
  v_term text;
  v_content text;
  v_attribution jsonb;
begin
  if p_order_id !~ '^order-[A-Za-z0-9_-]{8,96}$' then
    raise exception 'INVALID_ORDER_ID';
  end if;

  select coalesce(metadata, '{}'::jsonb) into v_metadata
  from public.order_records
  where id = p_order_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_metadata ? 'marketingAttribution' then
    return jsonb_build_object('captured', false, 'reason', 'already-captured');
  end if;

  v_session_id := left(btrim(coalesce(p_attribution->>'anonymousSessionId', '')), 64);
  if v_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('captured', false, 'reason', 'no-consented-session');
  end if;

  v_source := lower(left(btrim(coalesce(p_attribution->>'source', 'direct')), 120));
  if v_source = '' or v_source = 'nix-p.com' or v_source = 'www.nix-p.com' or v_source like '%.nix-p.com' then v_source := 'direct'; end if;
  if v_source in ('instagram.com', 'www.instagram.com', 'm.instagram.com', 'l.instagram.com') then v_source := 'instagram'; end if;
  if v_source in ('tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com') then v_source := 'tiktok'; end if;
  if v_source in ('facebook.com', 'www.facebook.com', 'm.facebook.com', 'l.facebook.com') then v_source := 'facebook'; end if;
  if v_source in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be') then v_source := 'youtube'; end if;
  if v_source in ('twitter.com', 'www.twitter.com', 'x.com', 'www.x.com') then v_source := 'x'; end if;

  v_medium := lower(left(btrim(coalesce(p_attribution->>'medium', '')), 120));
  v_campaign := lower(left(btrim(coalesce(p_attribution->>'campaign', '')), 120));
  v_term := lower(left(btrim(coalesce(p_attribution->>'term', '')), 120));
  v_content := lower(left(btrim(coalesce(p_attribution->>'content', '')), 120));
  v_attribution := jsonb_build_object(
    'version', 1,
    'anonymousSessionId', v_session_id,
    'source', v_source,
    'medium', v_medium,
    'campaign', v_campaign,
    'term', v_term,
    'content', v_content,
    'capturedAt', now()
  );

  update public.order_records
  set metadata = jsonb_set(v_metadata, '{marketingAttribution}', v_attribution, true), updated_at = now()
  where id = p_order_id;
  return jsonb_build_object('captured', true, 'source', v_source, 'campaign', v_campaign);
end;
$$;

create index if not exists order_records_paid_at_idx
  on public.order_records (paid_at desc)
  where paid_at is not null;

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
    select count(distinct anonymous_session_id)::integer as sessions,
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
    select coalesce(nullif(country_code::text, ''), 'UNKNOWN') as name,
      sum(page_views + product_views + product_clicks + add_to_cart_count + checkout_starts)::integer as count
    from activity group by 1 order by 2 desc, 1 asc limit 20
  ),
  devices as (
    select coalesce(nullif(device_type, ''), 'unknown') as name,
      sum(page_views + product_views + product_clicks + add_to_cart_count + checkout_starts)::integer as count
    from activity group by 1 order by 2 desc, 1 asc limit 20
  ),
  event_sources as (
    select source, medium, campaign, count(distinct anonymous_session_id)::integer as sessions,
      coalesce(sum(product_views), 0)::integer as product_views,
      coalesce(sum(product_clicks), 0)::integer as product_clicks,
      coalesce(sum(add_to_cart_count), 0)::integer as added
    from activity group by source, medium, campaign
  ),
  attributed_orders as (
    select
      coalesce(nullif(lower(btrim(order_record.metadata->'marketingAttribution'->>'source')), ''), 'direct') as source,
      coalesce(nullif(lower(btrim(order_record.metadata->'marketingAttribution'->>'medium')), ''), '') as medium,
      coalesce(nullif(lower(btrim(order_record.metadata->'marketingAttribution'->>'campaign')), ''), '') as campaign,
      count(*)::integer as paid_orders,
      coalesce(sum(order_record.grand_total), 0)::integer as sales
    from public.order_records order_record
    where coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) >= p_from_date::timestamp at time zone 'Asia/Jakarta'
      and coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) < (p_to_date + 1)::timestamp at time zone 'Asia/Jakarta'
      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
      and jsonb_typeof(order_record.metadata->'marketingAttribution') = 'object'
      and coalesce(order_record.metadata->'marketingAttribution'->>'anonymousSessionId', '') <> ''
    group by 1, 2, 3
  ),
  sources as (
    select coalesce(event_sources.source, attributed_orders.source) as source,
      coalesce(event_sources.medium, attributed_orders.medium) as medium,
      coalesce(event_sources.campaign, attributed_orders.campaign) as campaign,
      coalesce(event_sources.sessions, 0)::integer as sessions,
      coalesce(event_sources.product_views, 0)::integer as product_views,
      coalesce(event_sources.product_clicks, 0)::integer as product_clicks,
      coalesce(event_sources.added, 0)::integer as added,
      coalesce(attributed_orders.paid_orders, 0)::integer as paid_orders,
      coalesce(attributed_orders.sales, 0)::integer as sales
    from event_sources full outer join attributed_orders
      on event_sources.source = attributed_orders.source
      and event_sources.medium = attributed_orders.medium
      and event_sources.campaign = attributed_orders.campaign
  )
  select jsonb_build_object(
    'metrics', (select jsonb_build_object(
      'sessions', coalesce(sessions, 0), 'pageViews', coalesce(page_views, 0), 'productViews', coalesce(product_views, 0),
      'productClicks', coalesce(product_clicks, 0), 'addToCart', coalesce(add_to_cart_count, 0), 'checkoutStarted', coalesce(checkout_starts, 0),
      'productViewSessions', coalesce(product_view_sessions, 0), 'addToCartSessions', coalesce(add_to_cart_sessions, 0), 'checkoutSessions', coalesce(checkout_sessions, 0)
    ) from totals),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count, 'share', count::numeric / nullif((select sum(count) from countries), 0)) order by count desc, name asc) from countries), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count, 'share', count::numeric / nullif((select sum(count) from devices), 0)) order by count desc, name asc) from devices), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
      'source', source, 'medium', medium, 'campaign', campaign, 'sessions', sessions,
      'productViews', product_views, 'productClicks', product_clicks, 'added', added,
      'paidOrders', paid_orders, 'sales', sales
    ) order by sales desc, sessions desc, source asc, campaign asc) from sources), '[]'::jsonb)
  );
$$;

create or replace function public.marketing_dashboard_products(p_from_date date, p_to_date date)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with products as (
    select metric.product_id as id,
      coalesce(nullif(max(metric.title), ''), nullif(max(product.title), ''), metric.product_id) as title,
      coalesce(nullif(max(metric.artist), ''), nullif(max(product.artist), ''), '') as artist,
      coalesce(sum(metric.product_views), 0)::integer as product_views,
      coalesce(sum(metric.product_clicks), 0)::integer as product_clicks,
      coalesce(sum(metric.add_to_cart_count), 0)::integer as added,
      coalesce(sum(metric.paid_orders), 0)::integer as orders,
      coalesce(sum(metric.units), 0)::integer as units,
      coalesce(sum(metric.gross_sales), 0)::integer as sales
    from public.marketing_product_metrics metric
    left join public.products product on product.id = metric.product_id
    where metric.metric_date between p_from_date and p_to_date
    group by metric.product_id
    order by coalesce(sum(metric.gross_sales), 0) desc, coalesce(sum(metric.product_views), 0) desc, metric.product_id asc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'artist', artist, 'productViews', product_views, 'productClicks', product_clicks,
    'added', added, 'orders', orders, 'units', units, 'sales', sales
  ) order by sales desc, product_views desc, id asc), '[]'::jsonb)
  from products;
$$;

create or replace function public.marketing_dashboard_monthly_report(p_month date default ((now() at time zone 'Asia/Jakarta')::date))
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as month_start,
      (date_trunc('month', p_month)::date + interval '1 month')::date as month_end,
      (date_trunc('month', p_month)::date - interval '1 month')::date as previous_start
  ),
  current_metrics as (
    select coalesce(sum(sessions), 0)::integer as sessions, coalesce(sum(page_views), 0)::integer as page_views,
      coalesce(sum(product_views), 0)::integer as product_views, coalesce(sum(product_clicks), 0)::integer as product_clicks,
      coalesce(sum(add_to_cart_count), 0)::integer as carts, coalesce(sum(checkout_starts), 0)::integer as checkouts,
      coalesce(sum(orders_paid), 0)::integer as paid_orders, coalesce(sum(gross_sales), 0)::integer as gross_sales,
      coalesce(sum(refund_amount), 0)::integer as refunds, coalesce(sum(net_sales), 0)::integer as net_sales
    from public.marketing_daily_metrics, bounds
    where metric_date >= month_start and metric_date < month_end
  ),
  previous_metrics as (
    select coalesce(sum(net_sales), 0)::integer as net_sales, coalesce(sum(orders_paid), 0)::integer as paid_orders,
      coalesce(sum(sessions), 0)::integer as sessions
    from public.marketing_daily_metrics, bounds
    where metric_date >= previous_start and metric_date < month_start
  ),
  marketing_expenses as (
    select
      lower(btrim(coalesce(item->>'marketingChannel', ''))) as source,
      lower(btrim(coalesce(item->>'marketingCampaign', ''))) as campaign,
      greatest(0, case when coalesce(item->>'amount', '') ~ '^[0-9]+(?:\\.[0-9]+)?$' then (item->>'amount')::numeric else 0 end)::integer as amount
    from public.finance_state_sections section
    cross join lateral jsonb_array_elements(case when jsonb_typeof(section.payload) = 'array' then section.payload else '[]'::jsonb end) item,
      bounds
    where section.section = 'expenses'
      and lower(btrim(coalesce(item->>'category', ''))) = 'marketing'
      and coalesce(item->>'date', '') >= bounds.month_start::text
      and coalesce(item->>'date', '') < bounds.month_end::text
  ),
  spend as (
    select coalesce(sum(amount), 0)::integer as total, coalesce(sum(amount) filter (where source = '' and campaign = ''), 0)::integer as untagged
    from marketing_expenses
  ),
  attributed_orders as (
    select
      coalesce(nullif(lower(btrim(order_record.metadata->'marketingAttribution'->>'source')), ''), 'direct') as source,
      coalesce(nullif(lower(btrim(order_record.metadata->'marketingAttribution'->>'campaign')), ''), '') as campaign,
      count(*)::integer as paid_orders, coalesce(sum(order_record.grand_total), 0)::integer as sales
    from public.order_records order_record, bounds
    where coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) >= bounds.month_start::timestamp at time zone 'Asia/Jakarta'
      and coalesce(order_record.paid_at, order_record.updated_at, order_record.created_at) < bounds.month_end::timestamp at time zone 'Asia/Jakarta'
      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
      and jsonb_typeof(order_record.metadata->'marketingAttribution') = 'object'
    group by 1, 2
  ),
  campaign_activity as (
    select source, campaign, count(distinct anonymous_session_id)::integer as sessions,
      coalesce(sum(product_views), 0)::integer as product_views, coalesce(sum(product_clicks), 0)::integer as product_clicks,
      coalesce(sum(add_to_cart_count), 0)::integer as carts, coalesce(sum(checkout_starts), 0)::integer as checkouts
    from public.marketing_session_activity, bounds
    where metric_date >= month_start and metric_date < month_end
    group by source, campaign
  ),
  campaign_spend as (
    select coalesce(nullif(source, ''), 'unassigned') as source, campaign, sum(amount)::integer as spend
    from marketing_expenses group by 1, 2
  ),
  campaigns as (
    select coalesce(campaign_activity.source, attributed_orders.source, campaign_spend.source) as source,
      coalesce(campaign_activity.campaign, attributed_orders.campaign, campaign_spend.campaign) as campaign,
      coalesce(campaign_activity.sessions, 0)::integer as sessions,
      coalesce(campaign_activity.product_views, 0)::integer as product_views,
      coalesce(campaign_activity.product_clicks, 0)::integer as product_clicks,
      coalesce(campaign_activity.carts, 0)::integer as carts,
      coalesce(campaign_activity.checkouts, 0)::integer as checkouts,
      coalesce(attributed_orders.paid_orders, 0)::integer as paid_orders,
      coalesce(attributed_orders.sales, 0)::integer as sales,
      coalesce(campaign_spend.spend, 0)::integer as spend
    from campaign_activity
    full outer join attributed_orders on campaign_activity.source = attributed_orders.source and campaign_activity.campaign = attributed_orders.campaign
    full outer join campaign_spend on coalesce(campaign_activity.source, attributed_orders.source) = campaign_spend.source
      and coalesce(campaign_activity.campaign, attributed_orders.campaign) = campaign_spend.campaign
  ),
  actions as (
    select event_type, count(*)::integer as count
    from public.marketing_events, bounds
    where occurred_at >= bounds.month_start::timestamp at time zone 'Asia/Jakarta'
      and occurred_at < bounds.month_end::timestamp at time zone 'Asia/Jakarta'
      and event_type in ('request_item_submitted', 'offer_submitted', 'social_outbound_click')
    group by event_type
  )
  select jsonb_build_object(
    'month', (select month_start from bounds),
    'summary', jsonb_build_object(
      'cashNetSales', (select net_sales from current_metrics), 'grossSales', (select gross_sales from current_metrics),
      'refunds', (select refunds from current_metrics), 'paidOrders', (select paid_orders from current_metrics),
      'marketingSpend', (select total from spend), 'untaggedSpend', (select untagged from spend),
      'attributableRevenue', coalesce((select sum(sales) from attributed_orders), 0)::integer,
      'attributableOrders', coalesce((select sum(paid_orders) from attributed_orders), 0)::integer,
      'roas', coalesce((select sum(sales) from attributed_orders), 0)::numeric / nullif((select total from spend), 0),
      'attributableCostPerOrder', (select total from spend)::numeric / nullif((select sum(paid_orders) from attributed_orders), 0),
      'consentedSessions', (select sessions from current_metrics), 'pageViews', (select page_views from current_metrics),
      'productViews', (select product_views from current_metrics), 'productClicks', (select product_clicks from current_metrics),
      'carts', (select carts from current_metrics), 'checkoutCreated', (select checkouts from current_metrics),
      'consentedCheckoutRate', (select checkouts::numeric / nullif(sessions, 0) from current_metrics),
      'consentedPurchaseRate', (select paid_orders::numeric / nullif(sessions, 0) from current_metrics)
    ),
    'comparison', jsonb_build_object(
      'previousMonth', (select previous_start from bounds), 'cashNetSales', (select net_sales from previous_metrics),
      'paidOrders', (select paid_orders from previous_metrics), 'consentedSessions', (select sessions from previous_metrics)
    ),
    'actions', coalesce((select jsonb_object_agg(event_type, count) from actions), '{}'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
      'source', source, 'campaign', campaign, 'sessions', sessions, 'productViews', product_views,
      'productClicks', product_clicks, 'carts', carts, 'checkoutCreated', checkouts, 'paidOrders', paid_orders,
      'sales', sales, 'spend', spend, 'roas', sales::numeric / nullif(spend, 0)
    ) order by sales desc, sessions desc, source asc, campaign asc) from (select * from campaigns order by sales desc, sessions desc, source asc, campaign asc limit 12) ranked), '[]'::jsonb),
    'topProducts', public.marketing_dashboard_products((select month_start from bounds), ((select month_end from bounds) - 1))
  );
$$;

revoke all on function public.attach_order_marketing_attribution(text, jsonb) from public, anon, authenticated;
revoke all on function public.marketing_dashboard_monthly_report(date) from public, anon, authenticated;
grant execute on function public.attach_order_marketing_attribution(text, jsonb), public.marketing_dashboard_session_summary(date, date), public.marketing_dashboard_products(date, date), public.marketing_dashboard_monthly_report(date) to service_role;

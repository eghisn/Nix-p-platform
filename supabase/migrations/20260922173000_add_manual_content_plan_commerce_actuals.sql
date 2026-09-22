-- Link attribution is useful when a unique campaign URL was used, but it is
-- intentionally optional. These nullable values let the private analytics
-- workspace record a verified manual actual without manufacturing attribution.

alter table public.marketing_content_plans
  add column if not exists actual_carts integer check (actual_carts >= 0),
  add column if not exists actual_paid_orders integer check (actual_paid_orders >= 0),
  add column if not exists actual_revenue integer check (actual_revenue >= 0);

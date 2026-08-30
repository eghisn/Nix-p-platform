-- Product edits are optimistic and field-scoped. The revision is changed only
-- by an authenticated Admin editorial write, allowing stale mobile/desktop
-- forms to be rejected instead of silently replacing newer data.
alter table public.products
  add column if not exists edit_revision bigint not null default 1 check (edit_revision > 0),
  add column if not exists editorial_updated_at timestamptz,
  add column if not exists editorial_updated_by text;

-- A research worker owns a job only until the lease expires. A future worker
-- can safely recover an invocation that timed out after claiming the row.
alter table public.catalog_research_jobs
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id text;

create index if not exists catalog_research_jobs_lease_idx
  on public.catalog_research_jobs (status, lease_expires_at)
  where status = 'processing';

-- Finance saves update only operational catalog columns for products that
-- already exist. Editorial JSON and identity fields remain Admin-owned.
create or replace function public.sync_finance_catalog_operational(p_updates jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with updates as (
    select
      value ->> 'id' as id,
      greatest(0, coalesce((value ->> 'price')::numeric, 0)) as price,
      coalesce((value ->> 'openToOffers')::boolean, false) as open_to_offers,
      case
        when nullif(value ->> 'minimumAcceptableOffer', '') is null then null
        else greatest(0, (value ->> 'minimumAcceptableOffer')::numeric)
      end as minimum_acceptable_offer,
      coalesce(nullif(value ->> 'updatedAt', '')::date, current_date) as updated_at
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb))
  ), changed as (
    update public.products as product
    set
      price = updates.price,
      open_to_offers = updates.open_to_offers,
      minimum_acceptable_offer = case when updates.open_to_offers then updates.minimum_acceptable_offer else null end,
      updated_at = updates.updated_at
    from updates
    where product.id = updates.id
    returning product.id
  )
  select count(*)::integer from changed;
$$;

revoke execute on function public.sync_finance_catalog_operational(jsonb) from public, anon, authenticated;
grant execute on function public.sync_finance_catalog_operational(jsonb) to service_role;

create or replace function public.save_admin_home_slider(p_updates jsonb, p_actor text)
returns setof public.products
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) as entry(value)
    left join public.products as product on product.id = entry.value ->> 'id'
    where product.id is null
       or product.edit_revision <> coalesce((entry.value ->> 'expectedRevision')::bigint, 0)
  ) then
    raise exception 'ADMIN_PRODUCT_CONFLICT' using errcode = '40001';
  end if;

  return query
  with updates as (
    select
      entry.value ->> 'id' as id,
      coalesce(entry.value -> 'homeCollections', '[]'::jsonb) as home_collections,
      coalesce(entry.value -> 'homeSlideSort', 'null'::jsonb) as home_slide_sort
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) as entry(value)
  )
  update public.products as product
  set
    raw = jsonb_set(
      jsonb_set(coalesce(product.raw, '{}'::jsonb), '{homeCollections}', updates.home_collections, true),
      '{homeSlideSort}', updates.home_slide_sort, true
    ),
    edit_revision = product.edit_revision + 1,
    editorial_updated_at = now(),
    editorial_updated_by = left(coalesce(nullif(p_actor, ''), 'admin'), 160)
  from updates
  where product.id = updates.id
  returning product.*;
end;
$$;

revoke execute on function public.save_admin_home_slider(jsonb, text) from public, anon, authenticated;
grant execute on function public.save_admin_home_slider(jsonb, text) to service_role;

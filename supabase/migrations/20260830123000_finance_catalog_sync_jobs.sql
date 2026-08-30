create table if not exists public.finance_catalog_sync_jobs (
  id text primary key,
  status text not null check (status in ('queued', 'processing', 'retry', 'synced', 'failed', 'cancelled')),
  target_skus jsonb not null default '[]'::jsonb,
  target_inventory_ids jsonb not null default '[]'::jsonb,
  changed_sections jsonb not null default '[]'::jsonb,
  full_inventory_sync boolean not null default false,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_retry_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  worker_id text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_catalog_sync_jobs_due_idx
  on public.finance_catalog_sync_jobs (status, next_retry_at, created_at);

create index if not exists finance_catalog_sync_jobs_lease_idx
  on public.finance_catalog_sync_jobs (lease_expires_at)
  where status = 'processing';

alter table public.finance_catalog_sync_jobs enable row level security;
revoke all on table public.finance_catalog_sync_jobs from anon, authenticated;
grant select, insert, update, delete on table public.finance_catalog_sync_jobs to service_role;

drop policy if exists "Private server access only" on public.finance_catalog_sync_jobs;
create policy "Private server access only"
  on public.finance_catalog_sync_jobs as restrictive for all to anon, authenticated
  using (false) with check (false);

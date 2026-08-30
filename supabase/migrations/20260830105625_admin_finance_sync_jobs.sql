-- Admin edits are committed before Finance mirrors them. This durable queue
-- makes any temporary Finance conflict visible and retryable without asking an
-- editor to save the product again or rewriting its editorial metadata.
create table if not exists public.admin_finance_sync_jobs (
  id text primary key,
  product_id text not null,
  product_revision bigint not null check (product_revision > 0),
  sku text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'retry', 'synced', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 12),
  next_retry_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  worker_id text,
  last_error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (product_id, product_revision)
);

create index if not exists admin_finance_sync_jobs_due_idx
  on public.admin_finance_sync_jobs (status, next_retry_at, created_at)
  where status in ('queued', 'retry');

create index if not exists admin_finance_sync_jobs_lease_idx
  on public.admin_finance_sync_jobs (status, lease_expires_at)
  where status = 'processing';

alter table public.admin_finance_sync_jobs enable row level security;
revoke all on table public.admin_finance_sync_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_finance_sync_jobs to service_role;

drop policy if exists "Admin Finance sync jobs service role only" on public.admin_finance_sync_jobs;
create policy "Admin Finance sync jobs service role only"
  on public.admin_finance_sync_jobs
  as restrictive
  for all
  to service_role
  using (true)
  with check (true);

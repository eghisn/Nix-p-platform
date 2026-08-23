-- Durable, server-only work queue for Finance -> Admin catalogue research.
-- A browser request is never the source of truth for a research run: jobs can
-- be resumed after a refresh, a serverless timeout, or a temporary source outage.
create table if not exists public.catalog_research_jobs (
  id text primary key,
  sku text not null,
  request_fingerprint text not null,
  research_version text not null,
  status text not null default 'queued' check (status in (
    'queued', 'processing', 'retry', 'ready', 'deployment_pending', 'live', 'failed', 'cancelled'
  )),
  stage text not null default 'queued' check (stage in (
    'queued', 'matching_release', 'enriching', 'validating', 'deployment', 'verification', 'complete'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 12),
  next_retry_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_source text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sku, request_fingerprint, research_version)
);

create index if not exists catalog_research_jobs_due_idx
  on public.catalog_research_jobs (status, next_retry_at, created_at);

create index if not exists catalog_research_jobs_sku_idx
  on public.catalog_research_jobs (sku, updated_at desc);

alter table public.catalog_research_jobs enable row level security;
revoke all on table public.catalog_research_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_research_jobs to service_role;

drop policy if exists "Catalog research jobs service role only" on public.catalog_research_jobs;
create policy "Catalog research jobs service role only"
  on public.catalog_research_jobs
  as restrictive
  for all
  to service_role
  using (true)
  with check (true);

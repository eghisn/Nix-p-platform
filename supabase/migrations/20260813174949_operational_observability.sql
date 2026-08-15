create table if not exists public.system_events (
  id bigint generated always as identity primary key,
  level text not null check (level in ('info', 'warning', 'error', 'critical')),
  source text not null,
  route text,
  message text not null,
  fingerprint text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_events_recent_idx
  on public.system_events (created_at desc, level, source);

create index if not exists system_events_fingerprint_idx
  on public.system_events (fingerprint, created_at desc);

alter table public.system_events enable row level security;
revoke all on table public.system_events from public, anon, authenticated;
grant select, insert, update, delete on table public.system_events to service_role;
grant usage, select on sequence public.system_events_id_seq to service_role;

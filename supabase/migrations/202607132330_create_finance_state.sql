create table if not exists public.finance_state (
  key text primary key,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_state enable row level security;

create or replace function public.set_finance_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_state_set_updated_at on public.finance_state;
create trigger finance_state_set_updated_at
before update on public.finance_state
for each row
execute function public.set_finance_state_updated_at();

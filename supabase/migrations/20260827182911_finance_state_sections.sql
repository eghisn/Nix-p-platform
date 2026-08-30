-- Finance previously persisted every ledger section as one JSON document. Keep that
-- document as a compatibility mirror for existing checkout SQL, while making each
-- section independently versioned for the Finance application.
create table if not exists public.finance_state_sections (
  section text primary key check (section in ('general', 'sales', 'expenses', 'inventory', 'inventoryStock', 'monthlyReports', 'openingCash', 'targets')),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_state_sections enable row level security;
revoke all on table public.finance_state_sections from anon, authenticated;
drop policy if exists "Private server access only" on public.finance_state_sections;
create policy "Private server access only"
  on public.finance_state_sections as restrictive for all to anon, authenticated
  using (false) with check (false);

with current_state as (
  select coalesce((select state from public.finance_state where key = 'main'), '{}'::jsonb) as state
), sections(section, fallback) as (
  values
    ('general', '[]'::jsonb),
    ('sales', '[]'::jsonb),
    ('expenses', '[]'::jsonb),
    ('inventory', '[]'::jsonb),
    ('inventoryStock', '[]'::jsonb),
    ('monthlyReports', '[]'::jsonb),
    ('openingCash', 'null'::jsonb),
    ('targets', '{}'::jsonb)
)
insert into public.finance_state_sections (section, payload)
select sections.section, coalesce(current_state.state -> sections.section, sections.fallback)
from current_state cross join sections
on conflict (section) do nothing;

create or replace function public.mirror_finance_state_to_sections()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_section text;
  v_payload jsonb;
begin
  -- The section writer updates the legacy mirror itself. Avoid an unnecessary
  -- second write and preserve the exact revisions returned to the client.
  if current_setting('nixp.finance_sections_write', true) = 'on' then
    return new;
  end if;

  foreach v_section in array array['general', 'sales', 'expenses', 'inventory', 'inventoryStock', 'monthlyReports', 'openingCash', 'targets'] loop
    v_payload := coalesce(new.state -> v_section,
      case
        when v_section in ('general', 'sales', 'expenses', 'inventory', 'inventoryStock', 'monthlyReports') then '[]'::jsonb
        when v_section = 'targets' then '{}'::jsonb
        else 'null'::jsonb
      end
    );
    if old.state -> v_section is distinct from v_payload then
      insert into public.finance_state_sections (section, payload)
      values (v_section, v_payload)
      on conflict (section) do update
      set payload = excluded.payload,
          revision = public.finance_state_sections.revision + 1,
          updated_at = now()
      where public.finance_state_sections.payload is distinct from excluded.payload;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists finance_state_mirror_sections on public.finance_state;
create trigger finance_state_mirror_sections
after update of state on public.finance_state
for each row execute function public.mirror_finance_state_to_sections();

create or replace function public.write_finance_state_sections(
  p_changes jsonb,
  p_expected_revisions jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_section text;
  v_revision bigint;
  v_expected bigint;
  v_state jsonb;
  v_allowed text[] := array['general', 'sales', 'expenses', 'inventory', 'inventoryStock', 'monthlyReports', 'openingCash', 'targets'];
begin
  if jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    return;
  end if;

  if exists (select 1 from jsonb_object_keys(p_changes) as candidate(section) where not (section = any(v_allowed))) then
    raise exception 'Invalid finance section.' using errcode = '22023';
  end if;

  insert into public.finance_state (key, state)
  values ('main', '{"general":[],"sales":[],"expenses":[],"inventory":[],"inventoryStock":[],"monthlyReports":[],"openingCash":null,"targets":{}}'::jsonb)
  on conflict (key) do nothing;

  select state into v_state from public.finance_state where key = 'main' for update;

  foreach v_section in array v_allowed loop
    continue when not (p_changes ? v_section);
    select revision into v_revision
    from public.finance_state_sections
    where section = v_section
    for update;

    if not found then
      raise exception 'Finance section % is missing.', v_section using errcode = 'P0001';
    end if;

    if p_expected_revisions ? v_section then
      begin
        v_expected := (p_expected_revisions ->> v_section)::bigint;
      exception when invalid_text_representation then
        raise exception 'Invalid finance revision.' using errcode = '22023';
      end;
      if v_expected <> v_revision then
        raise exception 'FINANCE_SECTION_CONFLICT:%', v_section using errcode = 'P0001';
      end if;
    end if;
  end loop;

  foreach v_section in array v_allowed loop
    continue when not (p_changes ? v_section);
    update public.finance_state_sections
    set payload = p_changes -> v_section,
        revision = revision + 1,
        updated_at = now()
    where section = v_section;
    v_state := jsonb_set(v_state, array[v_section], p_changes -> v_section, true);
  end loop;

  perform set_config('nixp.finance_sections_write', 'on', true);
  update public.finance_state set state = v_state where key = 'main';
end;
$$;

revoke all on function public.mirror_finance_state_to_sections() from public, anon, authenticated;
revoke all on function public.write_finance_state_sections(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_finance_state_sections(jsonb, jsonb) to service_role;

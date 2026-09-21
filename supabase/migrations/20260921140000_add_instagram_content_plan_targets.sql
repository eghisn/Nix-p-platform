-- Additional planning targets. Existing content plans keep zero defaults and
-- remain readable by the marketing dashboard without any data migration.

alter table public.marketing_content_plans
  add column if not exists target_reach integer not null default 0 check (target_reach >= 0),
  add column if not exists target_saves_shares integer not null default 0 check (target_saves_shares >= 0),
  add column if not exists target_profile_visits integer not null default 0 check (target_profile_visits >= 0),
  add column if not exists target_new_followers integer not null default 0 check (target_new_followers >= 0);

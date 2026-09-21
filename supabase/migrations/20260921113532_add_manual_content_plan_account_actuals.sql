-- Profile visits and follower movement are account-level outcomes. Keep a
-- nullable manual actual per plan so an unentered value is never read as zero.

alter table public.marketing_content_plans
  add column if not exists actual_profile_visits integer check (actual_profile_visits >= 0),
  add column if not exists actual_new_followers integer check (actual_new_followers >= 0);

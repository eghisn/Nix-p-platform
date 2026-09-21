-- Bio link taps can be checked against Meta at account level, while a content
-- plan retains a nullable manual actual for post-specific reporting.

alter table public.marketing_content_plans
  add column if not exists target_bio_link_taps integer not null default 0 check (target_bio_link_taps >= 0),
  add column if not exists actual_bio_link_taps integer check (actual_bio_link_taps >= 0);

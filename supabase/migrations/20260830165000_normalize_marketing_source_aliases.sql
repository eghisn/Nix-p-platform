-- Keep the first reporting migration immutable; this follow-up also repairs
-- the short UTM source used by existing Instagram links.
update public.marketing_events
set source = 'instagram'
where lower(coalesce(source, '')) = 'ig';

select public.refresh_marketing_rollups(
  ((now() at time zone 'Asia/Jakarta')::date - 7),
  (now() at time zone 'Asia/Jakarta')::date
);

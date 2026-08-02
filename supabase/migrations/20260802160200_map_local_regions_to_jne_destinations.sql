alter table public.jne_destinations add column if not exists local_region_code text;
create unique index if not exists jne_destinations_local_region_code_idx on public.jne_destinations (local_region_code) where local_region_code is not null and active;

update public.jne_destinations
set local_region_code = '32.73',
    updated_at = now()
where jne_destination_code = 'BDO10000' and local_region_code is null;

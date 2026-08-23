-- Historical production migration marker. This extension was enabled in the
-- connected Supabase project before its migration file was committed here.
-- Keeping the exact version in Git lets Supabase previews reproduce history.
create extension if not exists pg_net with schema extensions;

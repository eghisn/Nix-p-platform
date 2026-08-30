-- Trigger functions are not an HTTP API. The section writer is called only by
-- the NIXP server with the Supabase service role.
alter function public.mirror_finance_state_to_sections() security invoker;

revoke all on function public.mirror_finance_state_to_sections() from public, anon, authenticated;
revoke all on function public.write_finance_state_sections(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_finance_state_sections(jsonb, jsonb) to service_role;

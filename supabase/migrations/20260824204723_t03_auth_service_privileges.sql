grant usage on schema public to service_role;
grant usage on type public.user_role to service_role;

grant select, insert, update, delete
on table public.profiles
to service_role;

grant select, insert
on table public.audit_logs
to service_role;

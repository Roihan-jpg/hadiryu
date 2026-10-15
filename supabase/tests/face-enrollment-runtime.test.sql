begin;
select plan(11);
select has_table('public','face_reauth_attempts','durable reauthentication attempts');
select has_table('public','face_reenrollment_grants','one-use recovery grants');
select ok(not has_table_privilege('authenticated','public.face_reauth_attempts','SELECT'),'no browser reauth access');
select ok(not has_table_privilege('anon','public.face_reenrollment_grants','INSERT'),'no anonymous recovery');
select ok(not has_function_privilege('authenticated','public.face_enrollment_claim(text,uuid,uuid)','EXECUTE'),'claim is backend only');
select ok(not has_function_privilege('anon','public.face_enrollment_finish(text,uuid,uuid,uuid,jsonb)','EXECUTE'),'finish is backend only');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'face_%' and p.prosecdef),0,'no SECURITY DEFINER face RPC');
select is((select count(*)::integer from pg_catalog.pg_tables where schemaname='public' and tablename in
 ('face_reauth_attempts','face_reenrollment_grants') and rowsecurity),2,'new tables use RLS');
select ok(exists(select 1 from pg_catalog.pg_constraint where conname='face_session_owner_fk'),'login session ownership constrained');
select has_trigger('public','profiles','face_disable_profile','disable freezes biometric lifecycle atomically');
select ok(not has_function_privilege('authenticated','private.face_disable_profile()','EXECUTE'),'browser cannot run lifecycle helper');
select * from finish();
rollback;

begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000101', 'security-user@absensi.invalid', '{"role":"SUPER_ADMIN"}'),
  ('00000000-0000-0000-0000-000000000102', 'security-admin@absensi.invalid', '{}');
insert into public.profiles (id, nip, full_name, role, is_active, must_change_password)
values
  ('00000000-0000-0000-0000-000000000101', 'SECURITY-USER', 'Security User', 'USER', true, false),
  ('00000000-0000-0000-0000-000000000102', 'SECURITY-ADMIN', 'Security Admin', 'SUPER_ADMIN', true, false);
insert into public.audit_logs (actor_id, action, entity_type, entity_id)
values (
  '00000000-0000-0000-0000-000000000102',
  'SECURITY_REGRESSION_FIXTURE',
  'profiles',
  '00000000-0000-0000-0000-000000000102'
);

select throws_ok(
  $$
    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      after_data
    ) values (
      '00000000-0000-0000-0000-000000000102',
      'UNSAFE_SECURITY_FIXTURE',
      'profiles',
      '00000000-0000-0000-0000-000000000102',
      '{"nested":{"refreshToken":"must-not-persist"}}'
    )
  $$,
  'P0001',
  'AUDIT_DATA_CONTAINS_SECRET',
  'audit payloads containing nested secret keys are rejected'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'schedule_rules',
        'geofence_rules',
        'calendar_exceptions',
        'payroll_rules',
        'attendance_records',
        'leave_requests',
        'attendance_admin_notes',
        'audit_logs'
      )
      and rowsecurity
  ),
  9,
  'RLS remains enabled on every exposed application table'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') ilike '%user_metadata%'
  ),
  0,
  'RLS policies never authorize from user_metadata'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name in (
        'profiles',
        'schedule_rules',
        'geofence_rules',
        'calendar_exceptions',
        'payroll_rules',
        'attendance_records',
        'leave_requests',
        'attendance_admin_notes',
        'audit_logs'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  0,
  'authenticated browser role has no direct write privileges'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated","app_metadata":{"role":"USER"},"user_metadata":{"role":"SUPER_ADMIN"}}',
  true
);

select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000102'),
  0::bigint,
  'USER cannot read another profile even with spoofed user_metadata role'
);
select is((select count(*) from public.schedule_rules), 0::bigint, 'USER cannot read schedules');
select is((select count(*) from public.audit_logs), 0::bigint, 'USER cannot read audit logs');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated","app_metadata":{"role":"SUPER_ADMIN"}}',
  true
);

select is(
  (
    select count(*)
    from public.profiles
    where id in (
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    )
  ),
  2::bigint,
  'SUPER_ADMIN can read profiles'
);
select is(
  (
    select count(*)
    from public.audit_logs
    where action = 'SECURITY_REGRESSION_FIXTURE'
  ),
  1::bigint,
  'SUPER_ADMIN can read audit logs'
);

select * from finish();
rollback;

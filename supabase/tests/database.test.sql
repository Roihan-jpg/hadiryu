begin;

select plan(42);

select has_type('public', 'user_role', 'user_role enum exists');
select has_type('public', 'schedule_type', 'schedule_type enum exists');
select has_type('public', 'calendar_exception_type', 'calendar_exception_type enum exists');
select has_type('public', 'attendance_status', 'attendance_status enum exists');
select has_type('public', 'leave_type', 'leave_type enum exists');
select has_type('public', 'leave_status', 'leave_status enum exists');

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'schedule_rules', 'schedule_rules table exists');
select has_table('public', 'geofence_rules', 'geofence_rules table exists');
select has_table('public', 'calendar_exceptions', 'calendar_exceptions table exists');
select has_table('public', 'payroll_rules', 'payroll_rules table exists');
select has_table('public', 'attendance_records', 'attendance_records table exists');
select has_table('public', 'leave_requests', 'leave_requests table exists');
select has_table('public', 'attendance_admin_notes', 'attendance_admin_notes table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');

select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_is_fk('public', 'profiles', 'id', 'profiles.id references auth.users');
select col_is_unique('public', 'profiles', 'nip', 'profiles.nip is unique');
select col_type_is('public', 'attendance_records', 'check_in_at', 'timestamp with time zone', 'attendance timestamp is timezone-aware');
select has_index('public', 'attendance_records', 'attendance_records_teacher_work_date_key', 'one attendance row exists per teacher and work date');
select has_index('public', 'leave_requests', 'leave_requests_teacher_date_active_idx', 'active leave is unique per teacher and date');

select is(
  (
    select count(*)
    from pg_class as table_class
    join pg_namespace as table_schema on table_schema.oid = table_class.relnamespace
    where table_schema.nspname = 'public'
      and table_class.relname in (
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
      and table_class.relrowsecurity
  ),
  9::bigint,
  'RLS is enabled on every exposed application table'
);

select throws_ok(
  $$
    insert into public.schedule_rules (
      schedule_type,
      check_in_open,
      work_start,
      check_in_close,
      checkout_open,
      work_end,
      checkout_close,
      target_minutes,
      effective_from
    ) values ('WEEKDAY', '07:00', '06:59', '08:00', '12:00', '15:00', '16:00', 515, '1900-01-01')
  $$,
  '23514',
  null,
  'schedule time order is constrained'
);

insert into public.schedule_rules (
  schedule_type,
  check_in_open,
  work_start,
  check_in_close,
  checkout_open,
  work_end,
  checkout_close,
  target_minutes,
  effective_from,
  effective_to
) values ('WEEKDAY', '05:30', '07:00', '08:00', '12:00', '15:35', '17:00', 515, '1900-01-01', '1900-12-31');

select throws_ok(
  $$
    insert into public.schedule_rules (
      schedule_type,
      check_in_open,
      work_start,
      check_in_close,
      checkout_open,
      work_end,
      checkout_close,
      target_minutes,
      effective_from,
      effective_to
    ) values ('WEEKDAY', '05:30', '07:00', '08:00', '12:00', '15:35', '17:00', 515, '1900-06-01', '1901-01-01')
  $$,
  '23P01',
  null,
  'overlapping schedule versions are rejected'
);

select throws_ok(
  $$
    update public.schedule_rules
    set target_minutes = 500
    where schedule_type = 'WEEKDAY'
      and effective_from = '1900-01-01'
  $$,
  'P0001',
  'Historical configuration is immutable; only an open version may be closed',
  'historical configuration cannot be edited in place'
);

select throws_ok(
  $$
    insert into public.geofence_rules (
      latitude,
      longitude,
      radius_meters,
      max_accuracy_meters,
      effective_from
    ) values (91, 106, 100, 20, '1900-01-01')
  $$,
  '23514',
  null,
  'invalid latitude is rejected'
);

select throws_ok(
  $$
    insert into public.payroll_rules (
      base_performance_pay,
      deduction_rate_per_minute,
      effective_from
    ) values (1000000, 1000, '1900-01-02')
  $$,
  '23514',
  null,
  'payroll rules can only start on the first day of a month'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000101', 'database-user-1@absensi.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000102', 'database-user-2@absensi.invalid', '{}'::jsonb);

insert into public.profiles (id, nip, full_name, role)
values
  ('00000000-0000-0000-0000-000000000101', 'TEST-001', 'Guru Test Satu', 'USER'),
  ('00000000-0000-0000-0000-000000000102', 'TEST-002', 'Guru Test Dua', 'USER');

insert into public.attendance_records (
  id,
  teacher_id,
  work_date,
  check_in_at,
  check_in_latitude,
  check_in_longitude,
  check_in_accuracy_meters,
  check_in_distance_meters,
  work_start,
  work_end,
  checkout_close,
  target_minutes,
  arrival_late_minutes,
  status
) values
  (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    '2026-08-24',
    '2026-08-24 00:00:00+00',
    -6.2,
    106.8,
    10,
    5,
    '07:00',
    '15:35',
    '17:00',
    515,
    0,
    'CHECKED_IN'
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000102',
    '2026-08-24',
    '2026-08-24 00:05:00+00',
    -6.2,
    106.8,
    10,
    5,
    '07:00',
    '15:35',
    '17:00',
    515,
    5,
    'CHECKED_IN'
  );

insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
values
  ('00000000-0000-0000-0000-000000000101', '2026-08-25', 'SICK', 'Pengujian database'),
  ('00000000-0000-0000-0000-000000000102', '2026-08-25', 'SICK', 'Pengujian database');

select throws_ok(
  $$
    insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
    values ('00000000-0000-0000-0000-000000000101', '2026-08-25', 'OTHER', 'Duplikat aktif')
  $$,
  '23505',
  null,
  'a teacher cannot have two active leave requests on one date'
);

select throws_ok(
  $$
    update public.attendance_records
    set check_in_at = '2026-08-24 00:10:00+00'
    where id = '00000000-0000-0000-0000-000000000201'
  $$,
  'P0001',
  'Attendance check-in data and schedule snapshot are immutable',
  'check-in timestamp is immutable'
);

insert into public.attendance_admin_notes (id, attendance_id, note, created_by)
values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  'Catatan uji',
  '00000000-0000-0000-0000-000000000102'
);

select throws_ok(
  $$
    update public.attendance_admin_notes
    set note = 'Diubah'
    where id = '00000000-0000-0000-0000-000000000301'
  $$,
  'P0001',
  'Append-only records cannot be updated or deleted',
  'attendance admin notes are append-only'
);

select throws_ok(
  $$
    delete from public.attendance_admin_notes
    where id = '00000000-0000-0000-0000-000000000301'
  $$,
  'P0001',
  'Append-only records cannot be updated or deleted',
  'attendance admin notes cannot be deleted'
);

insert into public.audit_logs (id, actor_id, action, entity_type, entity_id)
values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000102',
  'DATABASE_TEST',
  'attendance_record',
  '00000000-0000-0000-0000-000000000201'
);

select throws_ok(
  $$
    delete from public.audit_logs
    where id = '00000000-0000-0000-0000-000000000401'
  $$,
  'P0001',
  'Append-only records cannot be updated or deleted',
  'audit logs are append-only'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated","app_metadata":{"role":"USER"}}',
  true
);

select is((select count(*) from public.profiles), 1::bigint, 'USER sees only their profile');
select is((select count(*) from public.attendance_records), 1::bigint, 'USER sees only their attendance');
select is((select count(*) from public.leave_requests), 1::bigint, 'USER sees only their leave requests');
select is((select count(*) from public.attendance_admin_notes), 1::bigint, 'USER sees notes for their attendance only');
select is((select count(*) from public.audit_logs), 0::bigint, 'USER cannot read audit logs');
select is((select count(*) from public.schedule_rules), 0::bigint, 'USER cannot read operational configuration directly');

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
  'SUPER_ADMIN can read all profiles'
);
select is(
  (
    select count(*)
    from public.attendance_records
    where id in (
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000202'
    )
  ),
  2::bigint,
  'SUPER_ADMIN can read all attendance records'
);
select is(
  (
    select count(*)
    from public.audit_logs
    where id = '00000000-0000-0000-0000-000000000401'
  ),
  1::bigint,
  'SUPER_ADMIN can read audit logs'
);
select ok((select count(*) from public.schedule_rules) >= 1, 'SUPER_ADMIN can read operational configuration');

select * from finish();
rollback;

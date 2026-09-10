begin;

select plan(62);

select has_type('public', 'user_role', 'user_role enum exists');
select has_type('public', 'schedule_type', 'schedule_type enum exists');
select has_type('public', 'calendar_exception_type', 'calendar_exception_type enum exists');
select has_type('public', 'attendance_status', 'attendance_status enum exists');
select has_type('public', 'leave_type', 'leave_type enum exists');
select has_type('public', 'leave_status', 'leave_status enum exists');
select has_type('public', 'payroll_calculation_mode', 'payroll calculation mode enum exists');
select has_type('public', 'early_departure_status', 'early departure status enum exists');

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'schedule_rules', 'schedule_rules table exists');
select has_table('public', 'geofence_rules', 'geofence_rules table exists');
select has_table('public', 'calendar_exceptions', 'calendar_exceptions table exists');
select has_table('public', 'payroll_rules', 'payroll_rules table exists');
select has_table('public', 'attendance_records', 'attendance_records table exists');
select has_table('public', 'leave_requests', 'leave_requests table exists');
select has_table('public', 'attendance_admin_notes', 'attendance_admin_notes table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');
select has_table('public', 'early_departure_requests', 'early departure requests table exists');
select has_table('public', 'reporting_settings', 'reporting settings table exists');

select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_is_fk('public', 'app_accounts', 'profile_id', 'app_accounts.profile_id references profiles');
select col_is_unique('public', 'profiles', 'nip', 'profiles.nip is unique');
select col_type_is('public', 'attendance_records', 'check_in_at', 'timestamp with time zone', 'attendance timestamp is timezone-aware');
select has_index('public', 'attendance_records', 'attendance_records_teacher_work_date_key', 'one attendance row exists per teacher and work date');
select has_index('public', 'leave_requests', 'leave_requests_teacher_date_active_idx', 'active leave is unique per teacher and date');
select has_index('public', 'early_departure_requests', 'early_departure_requests_attendance_id_key', 'one early departure request exists per attendance');
select has_column('public', 'payroll_rules', 'minimum_performance_pay', 'payroll minimum is versioned');
select has_column('public', 'payroll_rules', 'late_deduction_amount', 'late deduction is versioned');
select has_column('public', 'payroll_rules', 'absent_deduction_amount', 'absence deduction is versioned');
select has_column('public', 'payroll_rules', 'rejected_early_departure_rate_per_hour', 'rejected early departure rate is versioned');
select has_column('public', 'payroll_rules', 'calculation_mode', 'payroll calculation mode is versioned');
select has_column('public', 'geofence_rules', 'polygon_vertices', 'polygon geofence vertices are versioned');
select has_column('public', 'attendance_records', 'check_in_boundary_clearance_meters', 'check-in snapshots polygon clearance');
select has_column('public', 'attendance_records', 'check_out_boundary_clearance_meters', 'checkout snapshots polygon clearance');
select has_column('public', 'early_departure_requests', 'boundary_clearance_meters', 'early departure snapshots polygon clearance');

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
        'audit_logs',
        'early_departure_requests',
        'reporting_settings'
      )
      and table_class.relrowsecurity
  ),
  11::bigint,
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
  'Historical configuration is immutable; only the current Jakarta date may be changed',
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

insert into public.payroll_rules (
  base_performance_pay,
  deduction_rate_per_minute,
  effective_from,
  effective_to
) values (1000000, 1000, '1900-01-01', '1900-12-31');

select is(
  (
    select calculation_mode::text
    from public.payroll_rules
    where effective_from = '1900-01-01'
  ),
  'LEGACY_PER_MINUTE',
  'existing payroll inserts retain legacy calculation semantics'
);

select throws_ok(
  $$
    insert into public.payroll_rules (
      calculation_mode,
      base_performance_pay,
      minimum_performance_pay,
      deduction_rate_per_minute,
      late_deduction_amount,
      absent_deduction_amount,
      rejected_early_departure_rate_per_hour,
      effective_from
    ) values ('MONTHLY_POLICY', 600000, 700000, 0, 10000, 20000, 10000, '1901-01-01')
  $$,
  '23514',
  null,
  'payroll minimum cannot exceed base pay'
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
  schedule_type,
  check_in_open_at,
  work_start_at,
  check_in_close_at,
  checkout_open_at,
  work_end_at,
  checkout_close_at,
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
    'WEEKDAY',
    '2026-08-23 22:30:00+00',
    '2026-08-24 00:00:00+00',
    '2026-08-24 01:00:00+00',
    '2026-08-24 05:00:00+00',
    '2026-08-24 08:35:00+00',
    '2026-08-24 10:00:00+00',
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
    'WEEKDAY',
    '2026-08-23 22:30:00+00',
    '2026-08-24 00:00:00+00',
    '2026-08-24 01:00:00+00',
    '2026-08-24 05:00:00+00',
    '2026-08-24 08:35:00+00',
    '2026-08-24 10:00:00+00',
    '07:00',
    '15:35',
    '17:00',
    515,
    5,
    'CHECKED_IN'
  );

select is(
  (
    select operational_start_date
    from public.save_reporting_settings(
      '00000000-0000-0000-0000-000000000102',
      '2026-08-01'
    )
  ),
  '2026-08-01'::date,
  'report operational start can be configured before production lock'
);

select throws_ok(
  $$
    select public.save_reporting_settings(
      '00000000-0000-0000-0000-000000000102',
      '2026-09-01'
    )
  $$,
  'P0001',
  'REPORTING_OPERATIONAL_START_LOCKED',
  'report operational start is locked after attendance exists'
);

insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
values
  ('00000000-0000-0000-0000-000000000101', '2026-08-25', 'SICK', 'Pengujian database'),
  ('00000000-0000-0000-0000-000000000102', '2026-08-25', 'SICK', 'Pengujian database');

insert into public.early_departure_requests (
  id,
  attendance_id,
  teacher_id,
  work_date,
  requested_at,
  reason,
  latitude,
  longitude,
  accuracy_meters,
  distance_meters
) values (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  '2026-08-24',
  '2026-08-24 06:00:00+00',
  'Keperluan keluarga',
  -6.2,
  106.8,
  10,
  5
);

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
select is((select count(*) from public.early_departure_requests), 1::bigint, 'USER sees only their early departure requests');
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
select is((select count(*) from public.early_departure_requests), 1::bigint, 'SUPER_ADMIN can read early departure requests');
select ok((select count(*) from public.schedule_rules) >= 1, 'SUPER_ADMIN can read operational configuration');

select * from finish();
rollback;

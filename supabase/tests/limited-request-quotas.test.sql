begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'quota-user@absensi.invalid', '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'quota-admin@absensi.invalid', '{}'::jsonb);

insert into public.profiles (id, nip, full_name, role)
values
  ('10000000-0000-4000-8000-000000000001', 'QUOTA-USER', 'Pengguna Kuota', 'USER'),
  ('10000000-0000-4000-8000-000000000002', 'QUOTA-ADMIN', 'Admin Kuota', 'SUPER_ADMIN');

select ok(
  'LATE_ARRIVAL' = any(enum_range(null::public.leave_type)::text[]),
  'leave type includes late arrival'
);

insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
values
  ('10000000-0000-4000-8000-000000000001', '2026-09-01', 'LATE_ARRIVAL', 'Terlambat pertama'),
  ('10000000-0000-4000-8000-000000000001', '2026-09-02', 'LATE_ARRIVAL', 'Terlambat kedua');

select is(
  (select count(*) from public.leave_requests where teacher_id = '10000000-0000-4000-8000-000000000001'),
  2::bigint,
  'two active late arrival requests are allowed in one calendar month'
);

select throws_ok(
  $$
    insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
    values ('10000000-0000-4000-8000-000000000001', '2026-09-03', 'LATE_ARRIVAL', 'Terlambat ketiga')
  $$,
  'P0001',
  'LATE_ARRIVAL_MONTHLY_LIMIT_REACHED',
  'a third active late arrival request is rejected'
);

update public.leave_requests
set status = 'REJECTED',
    decided_by = '10000000-0000-4000-8000-000000000002',
    decided_at = '2026-08-31 12:00:00+00'
where teacher_id = '10000000-0000-4000-8000-000000000001'
  and leave_date = '2026-09-01';

select lives_ok(
  $$
    insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
    values ('10000000-0000-4000-8000-000000000001', '2026-09-03', 'LATE_ARRIVAL', 'Pengganti kuota')
  $$,
  'a rejected late arrival request releases its quota'
);

select lives_ok(
  $$
    insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
    values ('10000000-0000-4000-8000-000000000001', '2026-10-01', 'LATE_ARRIVAL', 'Bulan baru')
  $$,
  'late arrival quota resets on the first calendar date of a month'
);

update public.leave_requests
set status = 'CANCELLED',
    decided_by = null,
    decided_at = null
where teacher_id = '10000000-0000-4000-8000-000000000001'
  and leave_date = '2026-09-03';

select lives_ok(
  $$
    insert into public.leave_requests (teacher_id, leave_date, leave_type, reason)
    values ('10000000-0000-4000-8000-000000000001', '2026-09-04', 'LATE_ARRIVAL', 'Pengganti setelah batal')
  $$,
  'a cancelled late arrival request releases its quota'
);

update public.leave_requests
set status = 'APPROVED',
    decided_by = '10000000-0000-4000-8000-000000000002',
    decided_at = '2026-09-01 00:00:00+00'
where teacher_id = '10000000-0000-4000-8000-000000000001'
  and leave_date = '2026-09-02';

select lives_ok(
  $$
    insert into public.attendance_records (
      id, teacher_id, work_date, check_in_at,
      check_in_latitude, check_in_longitude, check_in_accuracy_meters,
      check_in_distance_meters, schedule_type,
      check_in_open_at, work_start_at, check_in_close_at,
      checkout_open_at, work_end_at, checkout_close_at,
      work_start, work_end, checkout_close,
      target_minutes, arrival_late_minutes, status
    ) values (
      '10000000-0000-4000-8000-000000000101',
      '10000000-0000-4000-8000-000000000001', '2026-09-02',
      '2026-09-02 02:00:00+00', -6.2, 106.8, 10, 5, 'WEEKDAY',
      '2026-09-01 23:00:00+00', '2026-09-02 00:00:00+00', '2026-09-02 05:00:00+00',
      '2026-09-02 08:00:00+00', '2026-09-02 08:35:00+00', '2026-09-02 10:00:00+00',
      '07:00', '15:35', '17:00', 515, 120, 'CHECKED_IN'
    )
  $$,
  'approved late arrival does not block check-in'
);

insert into public.attendance_records (
  id, teacher_id, work_date, check_in_at,
  check_in_latitude, check_in_longitude, check_in_accuracy_meters,
  check_in_distance_meters, schedule_type,
  check_in_open_at, work_start_at, check_in_close_at,
  checkout_open_at, work_end_at, checkout_close_at,
  work_start, work_end, checkout_close,
  target_minutes, arrival_late_minutes, status
) values
  ('10000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000001', '2026-10-02', '2026-10-02 00:00:00+00', -6.2, 106.8, 10, 5, 'WEEKDAY', '2026-10-01 23:00:00+00', '2026-10-02 00:00:00+00', '2026-10-02 05:00:00+00', '2026-10-02 08:00:00+00', '2026-10-02 08:35:00+00', '2026-10-02 10:00:00+00', '07:00', '15:35', '17:00', 515, 0, 'CHECKED_IN'),
  ('10000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000001', '2026-10-03', '2026-10-03 00:00:00+00', -6.2, 106.8, 10, 5, 'WEEKDAY', '2026-10-02 23:00:00+00', '2026-10-03 00:00:00+00', '2026-10-03 05:00:00+00', '2026-10-03 08:00:00+00', '2026-10-03 08:35:00+00', '2026-10-03 10:00:00+00', '07:00', '15:35', '17:00', 515, 0, 'CHECKED_IN'),
  ('10000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000001', '2026-10-04', '2026-10-04 00:00:00+00', -6.2, 106.8, 10, 5, 'WEEKDAY', '2026-10-03 23:00:00+00', '2026-10-04 00:00:00+00', '2026-10-04 05:00:00+00', '2026-10-04 08:00:00+00', '2026-10-04 08:35:00+00', '2026-10-04 10:00:00+00', '07:00', '15:35', '17:00', 515, 0, 'CHECKED_IN');

insert into public.early_departure_requests (
  attendance_id, teacher_id, work_date, requested_at, reason,
  latitude, longitude, accuracy_meters, distance_meters
) values
  ('10000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000001', '2026-10-02', '2026-10-02 06:00:00+00', 'Pulang pertama', -6.2, 106.8, 10, 5),
  ('10000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000001', '2026-10-03', '2026-10-03 06:00:00+00', 'Pulang kedua', -6.2, 106.8, 10, 5);

select throws_ok(
  $$
    insert into public.early_departure_requests (
      attendance_id, teacher_id, work_date, requested_at, reason,
      latitude, longitude, accuracy_meters, distance_meters
    ) values (
      '10000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000001',
      '2026-10-04', '2026-10-04 06:00:00+00', 'Pulang ketiga', -6.2, 106.8, 10, 5
    )
  $$,
  'P0001',
  'EARLY_DEPARTURE_MONTHLY_LIMIT_REACHED',
  'a third active early departure request is rejected independently'
);

update public.early_departure_requests
set status = 'REJECTED',
    decided_by = '10000000-0000-4000-8000-000000000002',
    decided_at = '2026-10-02 07:00:00+00'
where attendance_id = '10000000-0000-4000-8000-000000000102';

select lives_ok(
  $$
    insert into public.early_departure_requests (
      attendance_id, teacher_id, work_date, requested_at, reason,
      latitude, longitude, accuracy_meters, distance_meters
    ) values (
      '10000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000001',
      '2026-10-04', '2026-10-04 06:00:00+00', 'Pengganti kuota pulang', -6.2, 106.8, 10, 5
    )
  $$,
  'a rejected early departure request releases its quota'
);

select * from finish();
rollback;

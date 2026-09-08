begin;

select plan(12);

select is(
  (select count(*) from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typnamespace = 'public'::regnamespace and t.typname = 'schedule_type'
      and e.enumlabel in ('SECURITY_DAY', 'SECURITY_NIGHT')),
  2::bigint,
  'schedule_type contains both Satpam shifts'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attendance_records' and column_name = 'schedule_type' and is_nullable = 'NO'),
  'attendance snapshot schedule_type is required'
);

select ok(
  (select count(*) = 6 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance_records'
      and column_name in ('check_in_open_at','work_start_at','check_in_close_at','checkout_open_at','work_end_at','checkout_close_at')
      and data_type = 'timestamp with time zone' and is_nullable = 'NO'),
  'attendance has six required operational timestamps'
);

select ok(
  exists (select 1 from pg_catalog.pg_constraint where conname = 'attendance_records_operational_timestamp_order_check'),
  'attendance operational timestamp order is constrained'
);

insert into public.profiles (id, nip, full_name, role, is_active) values
  ('91000000-0000-4000-8000-000000000001', 'SEC-ADMIN', 'Admin Security Test', 'SUPER_ADMIN', true),
  ('91000000-0000-4000-8000-000000000011', 'SEC-011', 'Satpam Satu', 'SECURITY_GUARD', true),
  ('91000000-0000-4000-8000-000000000012', 'SEC-012', 'Satpam Dua', 'SECURITY_GUARD', true),
  ('91000000-0000-4000-8000-000000000013', 'SEC-013', 'Satpam Tiga', 'SECURITY_GUARD', true);

select lives_ok(
  $$select public.save_security_schedule_settings(
    '91000000-0000-4000-8000-000000000001',
    '{"checkInOpen":"05:00","workStart":"06:00","checkInClose":"08:00","checkoutOpen":"17:00","workEnd":"18:00","checkoutClose":"20:00","targetMinutes":720}',
    '{"checkInOpen":"17:00","workStart":"18:00","checkInClose":"20:00","checkoutOpen":"05:00","workEnd":"06:00","checkoutClose":"08:00","targetMinutes":720}',
    '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000012',
    '91000000-0000-4000-8000-000000000013'
  )$$,
  'night shift crossing midnight saves atomically'
);

select lives_ok(
  $$select public.save_security_schedule_settings(
    '91000000-0000-4000-8000-000000000001',
    '{"checkInOpen":"05:15","workStart":"06:00","checkInClose":"08:00","checkoutOpen":"17:00","workEnd":"18:00","checkoutClose":"20:00","targetMinutes":720}',
    '{"checkInOpen":"17:00","workStart":"18:00","checkInClose":"20:00","checkoutOpen":"05:00","workEnd":"06:00","checkoutClose":"08:00","targetMinutes":720}',
    '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000012',
    '91000000-0000-4000-8000-000000000013'
  )$$,
  'the current server-date version can be updated'
);

select is(
  (select count(*) from public.security_schedule_settings),
  1::bigint,
  'same-day saves update rather than duplicate the version'
);

select throws_ok(
  $$select public.save_security_schedule_settings(
    '91000000-0000-4000-8000-000000000001', '{}'::jsonb, '{}'::jsonb,
    '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000013'
  )$$,
  'P0001',
  'SECURITY_ROSTER_MEMBER_INVALID',
  'duplicate roster members are rejected'
);

select is(
  (select count(*) from public.audit_logs where action = 'SECURITY_SCHEDULE_SETTINGS_SAVED' and actor_id = '91000000-0000-4000-8000-000000000001'),
  2::bigint,
  'each successful Satpam configuration save writes one audit record'
);

select throws_ok(
  $$update public.profiles set is_active = false
      where id = '91000000-0000-4000-8000-000000000011'$$,
  'P0001',
  'SECURITY_GUARD_IN_ACTIVE_ROSTER',
  'an active roster member cannot be deactivated'
);

insert into public.security_schedule_settings (
  day_shift, night_shift,
  day_one_morning_guard_id, day_one_night_guard_id, day_one_off_guard_id,
  effective_from, effective_to
) values (
  '{}'::jsonb, '{}'::jsonb,
  '91000000-0000-4000-8000-000000000011',
  '91000000-0000-4000-8000-000000000012',
  '91000000-0000-4000-8000-000000000013',
  ((statement_timestamp() at time zone 'Asia/Jakarta')::date - 3),
  ((statement_timestamp() at time zone 'Asia/Jakarta')::date - 1)
);

select throws_ok(
  $$update public.security_schedule_settings
      set day_shift = '{"changed":true}'::jsonb
      where effective_from = ((statement_timestamp() at time zone 'Asia/Jakarta')::date - 3)$$,
  'P0001',
  'Historical Satpam schedule versions are immutable',
  'historical Satpam configuration cannot be edited'
);

select throws_ok(
  $$delete from public.security_schedule_settings
      where effective_from = ((statement_timestamp() at time zone 'Asia/Jakarta')::date - 3)$$,
  'P0001',
  'Historical Satpam schedule versions cannot be deleted',
  'historical Satpam configuration cannot be deleted'
);

rollback;

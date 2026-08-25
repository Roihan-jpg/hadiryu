-- Development-only configuration. Coordinates are a generic Jakarta example,
-- not a production school location. No account, password, token, or secret is seeded.

insert into public.schedule_rules (
  id,
  schedule_type,
  check_in_open,
  work_start,
  check_in_close,
  checkout_open,
  work_end,
  checkout_close,
  target_minutes,
  effective_from,
  created_at,
  updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'WEEKDAY',
    '05:30',
    '07:00',
    '08:00',
    '12:00',
    '15:35',
    '17:00',
    515,
    '2026-01-01',
    '2026-01-01 00:00:00+00',
    '2026-01-01 00:00:00+00'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'SATURDAY',
    '05:30',
    '07:00',
    '08:00',
    '09:30',
    '10:35',
    '12:00',
    215,
    '2026-01-01',
    '2026-01-01 00:00:00+00',
    '2026-01-01 00:00:00+00'
  );

insert into public.geofence_rules (
  id,
  latitude,
  longitude,
  radius_meters,
  max_accuracy_meters,
  effective_from,
  created_at,
  updated_at
) values (
  '20000000-0000-4000-8000-000000000001',
  -6.200000,
  106.816666,
  100,
  50,
  '2026-01-01',
  '2026-01-01 00:00:00+00',
  '2026-01-01 00:00:00+00'
);

insert into public.payroll_rules (
  id,
  base_performance_pay,
  deduction_rate_per_minute,
  effective_from,
  created_at,
  updated_at
) values (
  '30000000-0000-0000-0000-000000000001',
  0,
  0,
  '2026-01-01',
  '2026-01-01 00:00:00+00',
  '2026-01-01 00:00:00+00'
);

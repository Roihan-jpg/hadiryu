grant update (
  check_out_at,
  check_out_latitude,
  check_out_longitude,
  check_out_accuracy_meters,
  check_out_distance_meters,
  worked_minutes,
  work_deficit_minutes,
  status
)
on table public.attendance_records
to service_role;

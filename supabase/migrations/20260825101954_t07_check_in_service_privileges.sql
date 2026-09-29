grant usage on type public.attendance_status to service_role;

grant select
on table
  public.schedule_rules,
  public.geofence_rules,
  public.calendar_exceptions,
  public.leave_requests
to service_role;

grant select, insert
on table public.attendance_records
to service_role;

create or replace function public.create_early_departure_request_with_attachment(
  p_teacher_id uuid,
  p_reason text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_distance_meters numeric,
  p_boundary_clearance_meters numeric,
  p_attachment_storage_path text,
  p_attachment_original_name text,
  p_attachment_mime_type text,
  p_attachment_size_bytes integer
)
returns public.early_departure_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_now timestamptz := pg_catalog.statement_timestamp();
  server_work_date date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  server_time time := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::time;
  attendance public.attendance_records%rowtype;
  request public.early_departure_requests%rowtype;
  calculated_worked_minutes integer;
  effective_work_end time;
  effective_target_minutes integer;
begin
  select * into attendance from public.attendance_records
  where teacher_id = p_teacher_id and work_date = server_work_date for update;
  if attendance.id is null then
    raise exception using errcode = 'P0001', message = 'CHECK_IN_REQUIRED';
  end if;
  if attendance.status <> 'CHECKED_IN' then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_ALREADY_COMPLETED';
  end if;

  effective_work_end := attendance.work_end;
  effective_target_minutes := attendance.target_minutes;
  if attendance.schedule_type in ('WEEKDAY', 'SATURDAY') then
    select work_end, target_minutes
    into effective_work_end, effective_target_minutes
    from public.schedule_rules
    where schedule_type = attendance.schedule_type
      and effective_from <= attendance.work_date
      and (effective_to is null or effective_to >= attendance.work_date)
    order by effective_from desc
    limit 1;
    if effective_work_end is null then
      raise exception using errcode = 'P0001', message = 'SCHEDULE_NOT_CONFIGURED';
    end if;
  end if;

  if server_time >= effective_work_end then
    raise exception using errcode = 'P0001', message = 'NOT_EARLY_DEPARTURE';
  end if;

  calculated_worked_minutes := greatest(0, pg_catalog.floor(
    extract(epoch from (server_now - attendance.check_in_at)) / 60
  )::integer);

  insert into public.early_departure_requests (
    attendance_id, teacher_id, work_date, requested_at, reason,
    latitude, longitude, accuracy_meters, distance_meters,
    boundary_clearance_meters, attachment_storage_path,
    attachment_original_name, attachment_mime_type, attachment_size_bytes
  ) values (
    attendance.id, p_teacher_id, server_work_date, server_now, p_reason,
    p_latitude, p_longitude, p_accuracy_meters, p_distance_meters,
    p_boundary_clearance_meters, p_attachment_storage_path,
    p_attachment_original_name, p_attachment_mime_type, p_attachment_size_bytes
  ) returning * into request;

  update public.attendance_records set
    check_out_at = server_now,
    check_out_latitude = p_latitude,
    check_out_longitude = p_longitude,
    check_out_accuracy_meters = p_accuracy_meters,
    check_out_distance_meters = p_distance_meters,
    check_out_boundary_clearance_meters = p_boundary_clearance_meters,
    worked_minutes = calculated_worked_minutes,
    work_deficit_minutes = greatest(0, effective_target_minutes - calculated_worked_minutes),
    status = 'COMPLETED'
  where id = attendance.id;
  return request;
end;
$$;

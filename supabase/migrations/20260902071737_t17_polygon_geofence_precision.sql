alter table public.geofence_rules
add column polygon_vertices jsonb;

alter table public.geofence_rules
add constraint geofence_rules_polygon_vertices_check check (
  polygon_vertices is null
  or (
    pg_catalog.jsonb_typeof(polygon_vertices) = 'array'
    and pg_catalog.jsonb_array_length(polygon_vertices) between 3 and 32
  )
),
add constraint geofence_rules_polygon_accuracy_check check (
  polygon_vertices is null or max_accuracy_meters between 5 and 30
);

alter table public.attendance_records
add column check_in_boundary_clearance_meters numeric(10, 2),
add column check_out_boundary_clearance_meters numeric(10, 2),
add constraint attendance_records_check_in_clearance_check check (
  check_in_boundary_clearance_meters is null
  or check_in_boundary_clearance_meters >= 0
),
add constraint attendance_records_check_out_clearance_check check (
  check_out_boundary_clearance_meters is null
  or check_out_boundary_clearance_meters >= 0
);

alter table public.early_departure_requests
add column boundary_clearance_meters numeric(10, 2),
add constraint early_departure_requests_clearance_check check (
  boundary_clearance_meters is null or boundary_clearance_meters >= 0
);

grant update (check_out_boundary_clearance_meters)
on table public.attendance_records
to service_role;

create or replace function public.save_geofence_settings(
  p_actor_id uuid,
  p_geofence jsonb
)
returns public.geofence_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date :=
    (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  old_geofence public.geofence_rules%rowtype;
  new_geofence public.geofence_rules%rowtype;
  future_geofence public.geofence_rules%rowtype;
begin
  if p_geofence ->> 'shape' is distinct from 'POLYGON'
    or pg_catalog.jsonb_typeof(p_geofence -> 'vertices') <> 'array'
    or pg_catalog.jsonb_array_length(p_geofence -> 'vertices') not between 3 and 32
    or (p_geofence ->> 'maxAccuracyMeters')::integer not between 5 and 30
  then
    raise exception using errcode = 'P0001', message = 'INVALID_POLYGON_GEOFENCE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('absensi.geofence_rules.version', 0)
  );

  for future_geofence in
    select *
    from public.geofence_rules
    where effective_from > today_jakarta
    order by effective_from
    for update
  loop
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      p_actor_id,
      'GEOFENCE_FUTURE_VERSION_CANCELLED',
      'geofence_rules',
      future_geofence.id,
      pg_catalog.jsonb_build_object(
        'shape', case when future_geofence.polygon_vertices is null then 'CIRCLE' else 'POLYGON' end,
        'latitude', future_geofence.latitude,
        'longitude', future_geofence.longitude,
        'radiusMeters', future_geofence.radius_meters,
        'vertices', future_geofence.polygon_vertices,
        'maxAccuracyMeters', future_geofence.max_accuracy_meters,
        'effectiveFrom', future_geofence.effective_from,
        'effectiveTo', future_geofence.effective_to
      ),
      null
    );
  end loop;

  delete from public.geofence_rules where effective_from > today_jakarta;

  select * into old_geofence
  from public.geofence_rules
  where effective_from <= today_jakarta
    and (effective_to is null or effective_to >= today_jakarta)
  order by effective_from desc
  limit 1
  for update;

  if old_geofence.id is not null
    and old_geofence.effective_from = today_jakarta
  then
    update public.geofence_rules
    set
      latitude = (p_geofence ->> 'latitude')::numeric,
      longitude = (p_geofence ->> 'longitude')::numeric,
      radius_meters = (p_geofence ->> 'radiusMeters')::integer,
      polygon_vertices = p_geofence -> 'vertices',
      max_accuracy_meters = (p_geofence ->> 'maxAccuracyMeters')::integer,
      effective_to = null
    where id = old_geofence.id
    returning * into new_geofence;
  else
    if old_geofence.id is not null then
      update public.geofence_rules
      set effective_to = today_jakarta - 1
      where id = old_geofence.id;
    end if;

    insert into public.geofence_rules (
      latitude,
      longitude,
      radius_meters,
      polygon_vertices,
      max_accuracy_meters,
      effective_from
    ) values (
      (p_geofence ->> 'latitude')::numeric,
      (p_geofence ->> 'longitude')::numeric,
      (p_geofence ->> 'radiusMeters')::integer,
      p_geofence -> 'vertices',
      (p_geofence ->> 'maxAccuracyMeters')::integer,
      today_jakarta
    ) returning * into new_geofence;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_id,
    'GEOFENCE_SETTINGS_SAVED',
    'geofence_rules',
    new_geofence.id,
    case when old_geofence.id is null then null else pg_catalog.jsonb_build_object(
      'shape', case when old_geofence.polygon_vertices is null then 'CIRCLE' else 'POLYGON' end,
      'latitude', old_geofence.latitude,
      'longitude', old_geofence.longitude,
      'radiusMeters', old_geofence.radius_meters,
      'vertices', old_geofence.polygon_vertices,
      'maxAccuracyMeters', old_geofence.max_accuracy_meters,
      'effectiveFrom', old_geofence.effective_from,
      'effectiveTo', old_geofence.effective_to
    ) end,
    pg_catalog.jsonb_build_object(
      'shape', 'POLYGON',
      'vertices', new_geofence.polygon_vertices,
      'maxAccuracyMeters', new_geofence.max_accuracy_meters,
      'effectiveFrom', new_geofence.effective_from,
      'effectiveTo', new_geofence.effective_to
    )
  );

  return new_geofence;
end;
$$;

create function public.create_early_departure_request(
  p_teacher_id uuid,
  p_reason text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_distance_meters numeric,
  p_boundary_clearance_meters numeric
)
returns public.early_departure_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_now timestamptz := pg_catalog.statement_timestamp();
  server_work_date date :=
    (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  server_time time :=
    (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::time;
  attendance public.attendance_records%rowtype;
  request public.early_departure_requests%rowtype;
  calculated_worked_minutes integer;
begin
  select * into attendance
  from public.attendance_records
  where teacher_id = p_teacher_id
    and work_date = server_work_date
  for update;

  if attendance.id is null then
    raise exception using errcode = 'P0001', message = 'CHECK_IN_REQUIRED';
  end if;
  if attendance.status <> 'CHECKED_IN' then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_ALREADY_COMPLETED';
  end if;
  if server_time >= attendance.work_end then
    raise exception using errcode = 'P0001', message = 'NOT_EARLY_DEPARTURE';
  end if;

  calculated_worked_minutes := greatest(
    0,
    pg_catalog.floor(
      extract(epoch from (server_now - attendance.check_in_at)) / 60
    )::integer
  );

  insert into public.early_departure_requests (
    attendance_id,
    teacher_id,
    work_date,
    requested_at,
    reason,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters,
    boundary_clearance_meters
  ) values (
    attendance.id,
    p_teacher_id,
    server_work_date,
    server_now,
    p_reason,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_distance_meters,
    p_boundary_clearance_meters
  ) returning * into request;

  update public.attendance_records
  set
    check_out_at = server_now,
    check_out_latitude = p_latitude,
    check_out_longitude = p_longitude,
    check_out_accuracy_meters = p_accuracy_meters,
    check_out_distance_meters = p_distance_meters,
    check_out_boundary_clearance_meters = p_boundary_clearance_meters,
    worked_minutes = calculated_worked_minutes,
    work_deficit_minutes = greatest(
      0,
      attendance.target_minutes - calculated_worked_minutes
    ),
    status = 'COMPLETED'
  where id = attendance.id;

  return request;
end;
$$;

revoke all on function public.create_early_departure_request(
  uuid, text, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.create_early_departure_request(
  uuid, text, numeric, numeric, numeric, numeric, numeric
) to service_role;

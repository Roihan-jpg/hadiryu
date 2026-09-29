grant usage on type public.schedule_type to service_role;

grant select, insert, update
on table public.schedule_rules
to service_role;

grant select, insert, update
on table public.geofence_rules
to service_role;

create function public.create_schedule_rule_versions(
  p_actor_id uuid,
  p_effective_from date,
  p_weekday jsonb,
  p_saturday jsonb
)
returns setof public.schedule_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_weekday public.schedule_rules%rowtype;
  old_saturday public.schedule_rules%rowtype;
  new_weekday public.schedule_rules%rowtype;
  new_saturday public.schedule_rules%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('absensi.schedule_rules.version', 0)
  );

  if p_effective_from < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date
  then
    raise exception using
      errcode = 'P0001',
      message = 'EFFECTIVE_DATE_IN_PAST';
  end if;

  if p_effective_from is null
    or exists (
      select 1
      from public.schedule_rules
      where effective_from >= p_effective_from
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'EFFECTIVE_DATE_CONFLICT';
  end if;

  select *
  into old_weekday
  from public.schedule_rules
  where schedule_type = 'WEEKDAY'
    and effective_to is null
  order by effective_from desc
  limit 1
  for update;

  select *
  into old_saturday
  from public.schedule_rules
  where schedule_type = 'SATURDAY'
    and effective_to is null
  order by effective_from desc
  limit 1
  for update;

  update public.schedule_rules
  set effective_to = p_effective_from - 1
  where effective_to is null;

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
  ) values (
    'WEEKDAY',
    (p_weekday ->> 'checkInOpen')::time,
    (p_weekday ->> 'workStart')::time,
    (p_weekday ->> 'checkInClose')::time,
    (p_weekday ->> 'checkoutOpen')::time,
    (p_weekday ->> 'workEnd')::time,
    (p_weekday ->> 'checkoutClose')::time,
    (p_weekday ->> 'targetMinutes')::integer,
    p_effective_from
  )
  returning * into new_weekday;

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
  ) values (
    'SATURDAY',
    (p_saturday ->> 'checkInOpen')::time,
    (p_saturday ->> 'workStart')::time,
    (p_saturday ->> 'checkInClose')::time,
    (p_saturday ->> 'checkoutOpen')::time,
    (p_saturday ->> 'workEnd')::time,
    (p_saturday ->> 'checkoutClose')::time,
    (p_saturday ->> 'targetMinutes')::integer,
    p_effective_from
  )
  returning * into new_saturday;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values
  (
    p_actor_id,
    'SCHEDULE_RULE_VERSION_CREATED',
    'schedule_rules',
    new_weekday.id,
    case when old_weekday.id is null then null else pg_catalog.jsonb_build_object(
      'scheduleType', old_weekday.schedule_type,
      'checkInOpen', pg_catalog.to_char(old_weekday.check_in_open, 'HH24:MI'),
      'workStart', pg_catalog.to_char(old_weekday.work_start, 'HH24:MI'),
      'checkInClose', pg_catalog.to_char(old_weekday.check_in_close, 'HH24:MI'),
      'checkoutOpen', pg_catalog.to_char(old_weekday.checkout_open, 'HH24:MI'),
      'workEnd', pg_catalog.to_char(old_weekday.work_end, 'HH24:MI'),
      'checkoutClose', pg_catalog.to_char(old_weekday.checkout_close, 'HH24:MI'),
      'targetMinutes', old_weekday.target_minutes,
      'effectiveFrom', old_weekday.effective_from,
      'effectiveTo', old_weekday.effective_to
    ) end,
    pg_catalog.jsonb_build_object(
      'scheduleType', new_weekday.schedule_type,
      'checkInOpen', pg_catalog.to_char(new_weekday.check_in_open, 'HH24:MI'),
      'workStart', pg_catalog.to_char(new_weekday.work_start, 'HH24:MI'),
      'checkInClose', pg_catalog.to_char(new_weekday.check_in_close, 'HH24:MI'),
      'checkoutOpen', pg_catalog.to_char(new_weekday.checkout_open, 'HH24:MI'),
      'workEnd', pg_catalog.to_char(new_weekday.work_end, 'HH24:MI'),
      'checkoutClose', pg_catalog.to_char(new_weekday.checkout_close, 'HH24:MI'),
      'targetMinutes', new_weekday.target_minutes,
      'effectiveFrom', new_weekday.effective_from,
      'effectiveTo', new_weekday.effective_to
    )
  ),
  (
    p_actor_id,
    'SCHEDULE_RULE_VERSION_CREATED',
    'schedule_rules',
    new_saturday.id,
    case when old_saturday.id is null then null else pg_catalog.jsonb_build_object(
      'scheduleType', old_saturday.schedule_type,
      'checkInOpen', pg_catalog.to_char(old_saturday.check_in_open, 'HH24:MI'),
      'workStart', pg_catalog.to_char(old_saturday.work_start, 'HH24:MI'),
      'checkInClose', pg_catalog.to_char(old_saturday.check_in_close, 'HH24:MI'),
      'checkoutOpen', pg_catalog.to_char(old_saturday.checkout_open, 'HH24:MI'),
      'workEnd', pg_catalog.to_char(old_saturday.work_end, 'HH24:MI'),
      'checkoutClose', pg_catalog.to_char(old_saturday.checkout_close, 'HH24:MI'),
      'targetMinutes', old_saturday.target_minutes,
      'effectiveFrom', old_saturday.effective_from,
      'effectiveTo', old_saturday.effective_to
    ) end,
    pg_catalog.jsonb_build_object(
      'scheduleType', new_saturday.schedule_type,
      'checkInOpen', pg_catalog.to_char(new_saturday.check_in_open, 'HH24:MI'),
      'workStart', pg_catalog.to_char(new_saturday.work_start, 'HH24:MI'),
      'checkInClose', pg_catalog.to_char(new_saturday.check_in_close, 'HH24:MI'),
      'checkoutOpen', pg_catalog.to_char(new_saturday.checkout_open, 'HH24:MI'),
      'workEnd', pg_catalog.to_char(new_saturday.work_end, 'HH24:MI'),
      'checkoutClose', pg_catalog.to_char(new_saturday.checkout_close, 'HH24:MI'),
      'targetMinutes', new_saturday.target_minutes,
      'effectiveFrom', new_saturday.effective_from,
      'effectiveTo', new_saturday.effective_to
    )
  );

  return next new_weekday;
  return next new_saturday;
end;
$$;

create function public.create_geofence_rule_version(
  p_actor_id uuid,
  p_effective_from date,
  p_geofence jsonb
)
returns public.geofence_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_geofence public.geofence_rules%rowtype;
  new_geofence public.geofence_rules%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('absensi.geofence_rules.version', 0)
  );

  if p_effective_from < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date
  then
    raise exception using
      errcode = 'P0001',
      message = 'EFFECTIVE_DATE_IN_PAST';
  end if;

  if p_effective_from is null
    or exists (
      select 1
      from public.geofence_rules
      where effective_from >= p_effective_from
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'EFFECTIVE_DATE_CONFLICT';
  end if;

  select *
  into old_geofence
  from public.geofence_rules
  where effective_to is null
  order by effective_from desc
  limit 1
  for update;

  update public.geofence_rules
  set effective_to = p_effective_from - 1
  where effective_to is null;

  insert into public.geofence_rules (
    latitude,
    longitude,
    radius_meters,
    max_accuracy_meters,
    effective_from
  ) values (
    (p_geofence ->> 'latitude')::numeric,
    (p_geofence ->> 'longitude')::numeric,
    (p_geofence ->> 'radiusMeters')::integer,
    (p_geofence ->> 'maxAccuracyMeters')::integer,
    p_effective_from
  )
  returning * into new_geofence;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values (
    p_actor_id,
    'GEOFENCE_RULE_VERSION_CREATED',
    'geofence_rules',
    new_geofence.id,
    case when old_geofence.id is null then null else pg_catalog.jsonb_build_object(
      'latitude', old_geofence.latitude,
      'longitude', old_geofence.longitude,
      'radiusMeters', old_geofence.radius_meters,
      'maxAccuracyMeters', old_geofence.max_accuracy_meters,
      'effectiveFrom', old_geofence.effective_from,
      'effectiveTo', old_geofence.effective_to
    ) end,
    pg_catalog.jsonb_build_object(
      'latitude', new_geofence.latitude,
      'longitude', new_geofence.longitude,
      'radiusMeters', new_geofence.radius_meters,
      'maxAccuracyMeters', new_geofence.max_accuracy_meters,
      'effectiveFrom', new_geofence.effective_from,
      'effectiveTo', new_geofence.effective_to
    )
  );

  return new_geofence;
end;
$$;

revoke all on function public.create_schedule_rule_versions(uuid, date, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.create_schedule_rule_versions(uuid, date, jsonb, jsonb)
to service_role;

revoke all on function public.create_geofence_rule_version(uuid, date, jsonb)
from public, anon, authenticated;
grant execute on function public.create_geofence_rule_version(uuid, date, jsonb)
to service_role;

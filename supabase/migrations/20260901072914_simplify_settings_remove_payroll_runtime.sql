create or replace function private.guard_versioned_rule_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date :=
    (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
begin
  if tg_table_name in ('schedule_rules', 'geofence_rules') then
    if old.effective_from = today_jakarta
      and new.id = old.id
      and new.effective_from = old.effective_from
      and new.created_at = old.created_at
      and (new.effective_to is null or new.effective_to >= today_jakarta)
    then
      return new;
    end if;

    if old.effective_from < today_jakarta
      and (old.effective_to is null or old.effective_to >= today_jakarta)
      and new.effective_to = today_jakarta - 1
      and (pg_catalog.to_jsonb(new) - array['effective_to', 'updated_at'])
        is not distinct from
        (pg_catalog.to_jsonb(old) - array['effective_to', 'updated_at'])
    then
      return new;
    end if;
  end if;

  if old.effective_to is null
    and new.effective_to is not null
    and new.effective_to >= old.effective_from
    and (pg_catalog.to_jsonb(new) - array['effective_to', 'updated_at'])
      is not distinct from
      (pg_catalog.to_jsonb(old) - array['effective_to', 'updated_at'])
  then
    return new;
  end if;

  raise exception 'Historical configuration is immutable; only the current Jakarta date may be changed';
end;
$$;

create function private.guard_versioned_rule_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name in ('schedule_rules', 'geofence_rules')
    and old.effective_from >
      (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date
  then
    return old;
  end if;

  raise exception 'Historical configuration cannot be deleted';
end;
$$;

revoke execute on function private.guard_versioned_rule_delete()
from public, anon, authenticated;

create trigger schedule_rules_guard_version_delete
before delete on public.schedule_rules
for each row execute function private.guard_versioned_rule_delete();

create trigger geofence_rules_guard_version_delete
before delete on public.geofence_rules
for each row execute function private.guard_versioned_rule_delete();

grant delete on table public.schedule_rules to service_role;
grant delete on table public.geofence_rules to service_role;

create function public.save_schedule_settings(
  p_actor_id uuid,
  p_weekday jsonb,
  p_saturday jsonb
)
returns setof public.schedule_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date :=
    (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  old_rule public.schedule_rules%rowtype;
  new_rule public.schedule_rules%rowtype;
  future_rule public.schedule_rules%rowtype;
  schedule_kind public.schedule_type;
  rule_input jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('absensi.schedule_rules.version', 0)
  );

  for future_rule in
    select *
    from public.schedule_rules
    where effective_from > today_jakarta
    order by effective_from, schedule_type
    for update
  loop
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      p_actor_id,
      'SCHEDULE_FUTURE_VERSION_CANCELLED',
      'schedule_rules',
      future_rule.id,
      pg_catalog.jsonb_build_object(
        'scheduleType', future_rule.schedule_type,
        'checkInOpen', pg_catalog.to_char(future_rule.check_in_open, 'HH24:MI'),
        'workStart', pg_catalog.to_char(future_rule.work_start, 'HH24:MI'),
        'checkInClose', pg_catalog.to_char(future_rule.check_in_close, 'HH24:MI'),
        'checkoutOpen', pg_catalog.to_char(future_rule.checkout_open, 'HH24:MI'),
        'workEnd', pg_catalog.to_char(future_rule.work_end, 'HH24:MI'),
        'checkoutClose', pg_catalog.to_char(future_rule.checkout_close, 'HH24:MI'),
        'targetMinutes', future_rule.target_minutes,
        'effectiveFrom', future_rule.effective_from,
        'effectiveTo', future_rule.effective_to
      ),
      null
    );
  end loop;

  delete from public.schedule_rules where effective_from > today_jakarta;

  for schedule_kind, rule_input in
    select 'WEEKDAY'::public.schedule_type, p_weekday
    union all
    select 'SATURDAY'::public.schedule_type, p_saturday
  loop
    old_rule := null;
    new_rule := null;

    select * into old_rule
    from public.schedule_rules
    where schedule_type = schedule_kind
      and effective_from <= today_jakarta
      and (effective_to is null or effective_to >= today_jakarta)
    order by effective_from desc
    limit 1
    for update;

    if old_rule.id is not null and old_rule.effective_from = today_jakarta then
      update public.schedule_rules
      set
        check_in_open = (rule_input ->> 'checkInOpen')::time,
        work_start = (rule_input ->> 'workStart')::time,
        check_in_close = (rule_input ->> 'checkInClose')::time,
        checkout_open = (rule_input ->> 'checkoutOpen')::time,
        work_end = (rule_input ->> 'workEnd')::time,
        checkout_close = (rule_input ->> 'checkoutClose')::time,
        target_minutes = (rule_input ->> 'targetMinutes')::integer,
        effective_to = null
      where id = old_rule.id
      returning * into new_rule;
    else
      if old_rule.id is not null then
        update public.schedule_rules
        set effective_to = today_jakarta - 1
        where id = old_rule.id;
      end if;

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
        schedule_kind,
        (rule_input ->> 'checkInOpen')::time,
        (rule_input ->> 'workStart')::time,
        (rule_input ->> 'checkInClose')::time,
        (rule_input ->> 'checkoutOpen')::time,
        (rule_input ->> 'workEnd')::time,
        (rule_input ->> 'checkoutClose')::time,
        (rule_input ->> 'targetMinutes')::integer,
        today_jakarta
      ) returning * into new_rule;
    end if;

    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      p_actor_id,
      'SCHEDULE_SETTINGS_SAVED',
      'schedule_rules',
      new_rule.id,
      case when old_rule.id is null then null else pg_catalog.jsonb_build_object(
        'scheduleType', old_rule.schedule_type,
        'checkInOpen', pg_catalog.to_char(old_rule.check_in_open, 'HH24:MI'),
        'workStart', pg_catalog.to_char(old_rule.work_start, 'HH24:MI'),
        'checkInClose', pg_catalog.to_char(old_rule.check_in_close, 'HH24:MI'),
        'checkoutOpen', pg_catalog.to_char(old_rule.checkout_open, 'HH24:MI'),
        'workEnd', pg_catalog.to_char(old_rule.work_end, 'HH24:MI'),
        'checkoutClose', pg_catalog.to_char(old_rule.checkout_close, 'HH24:MI'),
        'targetMinutes', old_rule.target_minutes,
        'effectiveFrom', old_rule.effective_from,
        'effectiveTo', old_rule.effective_to
      ) end,
      pg_catalog.jsonb_build_object(
        'scheduleType', new_rule.schedule_type,
        'checkInOpen', pg_catalog.to_char(new_rule.check_in_open, 'HH24:MI'),
        'workStart', pg_catalog.to_char(new_rule.work_start, 'HH24:MI'),
        'checkInClose', pg_catalog.to_char(new_rule.check_in_close, 'HH24:MI'),
        'checkoutOpen', pg_catalog.to_char(new_rule.checkout_open, 'HH24:MI'),
        'workEnd', pg_catalog.to_char(new_rule.work_end, 'HH24:MI'),
        'checkoutClose', pg_catalog.to_char(new_rule.checkout_close, 'HH24:MI'),
        'targetMinutes', new_rule.target_minutes,
        'effectiveFrom', new_rule.effective_from,
        'effectiveTo', new_rule.effective_to
      )
    );

    return next new_rule;
  end loop;
end;
$$;

create function public.save_geofence_settings(
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
        'latitude', future_geofence.latitude,
        'longitude', future_geofence.longitude,
        'radiusMeters', future_geofence.radius_meters,
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
      max_accuracy_meters,
      effective_from
    ) values (
      (p_geofence ->> 'latitude')::numeric,
      (p_geofence ->> 'longitude')::numeric,
      (p_geofence ->> 'radiusMeters')::integer,
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

revoke all on function public.save_schedule_settings(uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.save_schedule_settings(uuid, jsonb, jsonb)
to service_role;

revoke all on function public.save_geofence_settings(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.save_geofence_settings(uuid, jsonb)
to service_role;

drop function public.create_schedule_rule_versions(uuid, date, jsonb, jsonb);
drop function public.create_geofence_rule_version(uuid, date, jsonb);

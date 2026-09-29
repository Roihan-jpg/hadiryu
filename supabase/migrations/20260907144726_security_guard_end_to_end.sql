alter table public.attendance_records
  add column schedule_type public.schedule_type,
  add column check_in_open_at timestamptz,
  add column work_start_at timestamptz,
  add column check_in_close_at timestamptz,
  add column checkout_open_at timestamptz,
  add column work_end_at timestamptz,
  add column checkout_close_at timestamptz;

-- Backfill must run before the new snapshot fields become immutable. The existing
-- checkout-only update guard would otherwise reject this one-time migration.
drop trigger attendance_records_guard_update on public.attendance_records;
drop trigger attendance_records_set_updated_at on public.attendance_records;

update public.attendance_records
set
  schedule_type = case
    when extract(isodow from work_date) = 6 then 'SATURDAY'::public.schedule_type
    else 'WEEKDAY'::public.schedule_type
  end,
  check_in_open_at = (work_date + work_start) at time zone 'Asia/Jakarta',
  work_start_at = (work_date + work_start) at time zone 'Asia/Jakarta',
  check_in_close_at = (work_date + work_start) at time zone 'Asia/Jakarta',
  checkout_open_at = (work_date + work_end) at time zone 'Asia/Jakarta',
  work_end_at = (work_date + work_end) at time zone 'Asia/Jakarta',
  checkout_close_at = (work_date + checkout_close) at time zone 'Asia/Jakarta';

alter table public.attendance_records
  alter column schedule_type set not null,
  alter column check_in_open_at set not null,
  alter column work_start_at set not null,
  alter column check_in_close_at set not null,
  alter column checkout_open_at set not null,
  alter column work_end_at set not null,
  alter column checkout_close_at set not null,
  drop constraint attendance_records_schedule_order_check,
  add constraint attendance_records_operational_timestamp_order_check check (
    check_in_open_at <= work_start_at
    and work_start_at <= check_in_close_at
    and check_in_close_at <= checkout_open_at
    and checkout_open_at <= work_end_at
    and work_end_at <= checkout_close_at
  );

create or replace function private.guard_attendance_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.id, new.teacher_id, new.work_date, new.check_in_at,
    new.check_in_latitude, new.check_in_longitude,
    new.check_in_accuracy_meters, new.check_in_distance_meters,
    new.schedule_type, new.check_in_open_at, new.work_start_at,
    new.check_in_close_at, new.checkout_open_at, new.work_end_at,
    new.checkout_close_at, new.work_start, new.work_end, new.checkout_close,
    new.target_minutes, new.arrival_late_minutes, new.created_at
  ) is distinct from row(
    old.id, old.teacher_id, old.work_date, old.check_in_at,
    old.check_in_latitude, old.check_in_longitude,
    old.check_in_accuracy_meters, old.check_in_distance_meters,
    old.schedule_type, old.check_in_open_at, old.work_start_at,
    old.check_in_close_at, old.checkout_open_at, old.work_end_at,
    old.checkout_close_at, old.work_start, old.work_end, old.checkout_close,
    old.target_minutes, old.arrival_late_minutes, old.created_at
  ) then
    raise exception 'Attendance check-in data and schedule snapshot are immutable';
  end if;

  if old.status <> 'CHECKED_IN'
    or old.check_out_at is not null
    or new.status <> 'COMPLETED'
    or new.check_out_at is null
  then
    raise exception 'Attendance checkout data is immutable once recorded';
  end if;

  return new;
end;
$$;

create trigger attendance_records_guard_update
before update on public.attendance_records
for each row execute function private.guard_attendance_update();
create trigger attendance_records_set_updated_at
before update on public.attendance_records
for each row execute function private.set_updated_at();

drop trigger if exists security_schedule_settings_set_updated_at
  on public.security_schedule_settings;
create trigger security_schedule_settings_set_updated_at
before update on public.security_schedule_settings
for each row execute function private.set_updated_at();

create or replace function private.guard_security_schedule_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
begin
  if tg_op = 'DELETE' then
    if old.effective_from <= today_jakarta then
      raise exception 'Historical Satpam schedule versions cannot be deleted';
    end if;
    return old;
  end if;

  if old.effective_from < today_jakarta and (
    old.effective_to is not null
    or new.effective_to is null
    or new.effective_to < old.effective_from
    or (pg_catalog.to_jsonb(new) - array['effective_to', 'updated_at'])
      is distinct from
      (pg_catalog.to_jsonb(old) - array['effective_to', 'updated_at'])
  ) then
    raise exception 'Historical Satpam schedule versions are immutable';
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_security_schedule_version()
  from public, anon, authenticated;

create trigger security_schedule_settings_guard_version
before update or delete on public.security_schedule_settings
for each row execute function private.guard_security_schedule_version();

create or replace function public.save_security_schedule_settings(
  p_actor_id uuid,
  p_day_shift jsonb,
  p_night_shift jsonb,
  p_day_one_morning_guard_id uuid,
  p_day_one_night_guard_id uuid,
  p_day_one_off_guard_id uuid
)
returns public.security_schedule_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  old_rule public.security_schedule_settings%rowtype;
  new_rule public.security_schedule_settings%rowtype;
  cancelled_future jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('absensi.security_schedule_settings.version', 0)
  );

  if p_day_one_morning_guard_id = p_day_one_night_guard_id
    or p_day_one_morning_guard_id = p_day_one_off_guard_id
    or p_day_one_night_guard_id = p_day_one_off_guard_id
    or exists (
      select 1 from public.profiles
      where id in (p_day_one_morning_guard_id, p_day_one_night_guard_id, p_day_one_off_guard_id)
        and (role <> 'SECURITY_GUARD' or not is_active)
    )
    or (
      select count(*) from public.profiles
      where id in (p_day_one_morning_guard_id, p_day_one_night_guard_id, p_day_one_off_guard_id)
    ) <> 3
  then
    raise exception using errcode = 'P0001', message = 'SECURITY_ROSTER_MEMBER_INVALID';
  end if;

  select * into old_rule
  from public.security_schedule_settings
  where effective_from <= today_jakarta
    and (effective_to is null or effective_to >= today_jakarta)
  order by effective_from desc
  limit 1
  for update;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(future)), '[]'::jsonb)
  into cancelled_future
  from public.security_schedule_settings future
  where future.effective_from > today_jakarta;

  delete from public.security_schedule_settings where effective_from > today_jakarta;

  if old_rule.id is not null and old_rule.effective_from = today_jakarta then
    update public.security_schedule_settings
    set
      day_shift = p_day_shift,
      night_shift = p_night_shift,
      day_one_morning_guard_id = p_day_one_morning_guard_id,
      day_one_night_guard_id = p_day_one_night_guard_id,
      day_one_off_guard_id = p_day_one_off_guard_id,
      effective_to = null
    where id = old_rule.id
    returning * into new_rule;
  else
    if old_rule.id is not null then
      update public.security_schedule_settings
      set effective_to = today_jakarta - 1
      where id = old_rule.id;
    end if;

    insert into public.security_schedule_settings(
      day_shift, night_shift,
      day_one_morning_guard_id, day_one_night_guard_id, day_one_off_guard_id,
      effective_from
    ) values (
      p_day_shift, p_night_shift,
      p_day_one_morning_guard_id, p_day_one_night_guard_id, p_day_one_off_guard_id,
      today_jakarta
    ) returning * into new_rule;
  end if;

  insert into public.audit_logs(
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_id,
    'SECURITY_SCHEDULE_SETTINGS_SAVED',
    'security_schedule_settings',
    new_rule.id,
    pg_catalog.jsonb_build_object(
      'effectiveVersion', case when old_rule.id is null then null else pg_catalog.to_jsonb(old_rule) - array['created_at', 'updated_at'] end,
      'cancelledFutureVersions', cancelled_future
    ),
    pg_catalog.to_jsonb(new_rule) - array['created_at', 'updated_at']
  );

  return new_rule;
end;
$$;

revoke all on function public.save_security_schedule_settings(uuid, jsonb, jsonb, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_security_schedule_settings(uuid, jsonb, jsonb, uuid, uuid, uuid)
  to service_role;

create or replace function private.guard_active_security_roster_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
begin
  if old.role = 'SECURITY_GUARD'
    and old.is_active
    and not new.is_active
    and exists (
      select 1
      from public.security_schedule_settings roster
      where roster.effective_from <= today_jakarta
        and (roster.effective_to is null or roster.effective_to >= today_jakarta)
        and old.id in (
          roster.day_one_morning_guard_id,
          roster.day_one_night_guard_id,
          roster.day_one_off_guard_id
        )
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'SECURITY_GUARD_IN_ACTIVE_ROSTER';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_active_security_roster_member()
  from public, anon, authenticated;

create trigger profiles_guard_active_security_roster_member
before update of is_active on public.profiles
for each row execute function private.guard_active_security_roster_member();

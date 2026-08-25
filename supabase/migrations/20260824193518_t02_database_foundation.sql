create extension if not exists btree_gist with schema extensions;

create type public.user_role as enum ('USER', 'SUPER_ADMIN');
create type public.schedule_type as enum ('WEEKDAY', 'SATURDAY');
create type public.calendar_exception_type as enum ('HOLIDAY', 'WORKING_DAY');
create type public.attendance_status as enum ('CHECKED_IN', 'COMPLETED');
create type public.leave_type as enum ('SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER');
create type public.leave_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  nip text not null unique,
  full_name text not null,
  role public.user_role not null default 'USER',
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nip_not_blank_check check (length(btrim(nip)) > 0),
  constraint profiles_full_name_not_blank_check check (length(btrim(full_name)) > 0)
);

create table public.schedule_rules (
  id uuid primary key default gen_random_uuid(),
  schedule_type public.schedule_type not null,
  check_in_open time without time zone not null,
  work_start time without time zone not null,
  check_in_close time without time zone not null,
  checkout_open time without time zone not null,
  work_end time without time zone not null,
  checkout_close time without time zone not null,
  target_minutes integer not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_rules_target_minutes_check check (target_minutes > 0),
  constraint schedule_rules_effective_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint schedule_rules_time_order_check check (
    check_in_open <= work_start
    and work_start <= check_in_close
    and check_in_close <= checkout_open
    and checkout_open <= work_end
    and work_end <= checkout_close
  ),
  constraint schedule_rules_no_overlapping_versions exclude using gist (
    schedule_type with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create table public.geofence_rules (
  id uuid primary key default gen_random_uuid(),
  latitude numeric(9, 6) not null,
  longitude numeric(10, 6) not null,
  radius_meters integer not null,
  max_accuracy_meters integer not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint geofence_rules_latitude_check check (latitude between -90 and 90),
  constraint geofence_rules_longitude_check check (longitude between -180 and 180),
  constraint geofence_rules_radius_check check (radius_meters between 25 and 1000),
  constraint geofence_rules_accuracy_check check (max_accuracy_meters between 5 and 200),
  constraint geofence_rules_effective_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint geofence_rules_no_overlapping_versions exclude using gist (
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create table public.calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  work_date date not null unique,
  exception_type public.calendar_exception_type not null,
  name text not null,
  schedule_type public.schedule_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_exceptions_name_not_blank_check check (
    length(btrim(name)) between 1 and 200
  ),
  constraint calendar_exceptions_schedule_type_check check (
    (exception_type = 'HOLIDAY' and schedule_type is null)
    or (exception_type = 'WORKING_DAY' and schedule_type is not null)
  )
);

create table public.payroll_rules (
  id uuid primary key default gen_random_uuid(),
  base_performance_pay numeric(14, 2) not null,
  deduction_rate_per_minute numeric(14, 2) not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_rules_base_pay_check check (base_performance_pay >= 0),
  constraint payroll_rules_deduction_rate_check check (deduction_rate_per_minute >= 0),
  constraint payroll_rules_month_start_check check (
    extract(day from effective_from) = 1
  ),
  constraint payroll_rules_effective_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint payroll_rules_no_overlapping_versions exclude using gist (
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  work_date date not null,
  check_in_at timestamptz not null,
  check_in_latitude numeric(9, 6) not null,
  check_in_longitude numeric(10, 6) not null,
  check_in_accuracy_meters numeric(10, 2) not null,
  check_in_distance_meters numeric(10, 2) not null,
  check_out_at timestamptz,
  check_out_latitude numeric(9, 6),
  check_out_longitude numeric(10, 6),
  check_out_accuracy_meters numeric(10, 2),
  check_out_distance_meters numeric(10, 2),
  work_start time without time zone not null,
  work_end time without time zone not null,
  checkout_close time without time zone not null,
  target_minutes integer not null,
  worked_minutes integer,
  arrival_late_minutes integer not null,
  work_deficit_minutes integer,
  status public.attendance_status not null default 'CHECKED_IN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_teacher_work_date_key unique (teacher_id, work_date),
  constraint attendance_records_check_in_latitude_check check (check_in_latitude between -90 and 90),
  constraint attendance_records_check_in_longitude_check check (check_in_longitude between -180 and 180),
  constraint attendance_records_check_in_accuracy_check check (check_in_accuracy_meters >= 0),
  constraint attendance_records_check_in_distance_check check (check_in_distance_meters >= 0),
  constraint attendance_records_check_out_latitude_check check (
    check_out_latitude is null or check_out_latitude between -90 and 90
  ),
  constraint attendance_records_check_out_longitude_check check (
    check_out_longitude is null or check_out_longitude between -180 and 180
  ),
  constraint attendance_records_check_out_accuracy_check check (
    check_out_accuracy_meters is null or check_out_accuracy_meters >= 0
  ),
  constraint attendance_records_check_out_distance_check check (
    check_out_distance_meters is null or check_out_distance_meters >= 0
  ),
  constraint attendance_records_checkout_after_check_in_check check (
    check_out_at is null or check_out_at >= check_in_at
  ),
  constraint attendance_records_schedule_order_check check (
    work_start <= work_end and work_end <= checkout_close
  ),
  constraint attendance_records_target_minutes_check check (target_minutes > 0),
  constraint attendance_records_worked_minutes_check check (
    worked_minutes is null or worked_minutes >= 0
  ),
  constraint attendance_records_arrival_late_minutes_check check (arrival_late_minutes >= 0),
  constraint attendance_records_work_deficit_minutes_check check (
    work_deficit_minutes is null or work_deficit_minutes >= 0
  ),
  constraint attendance_records_checkout_location_check check (
    (
      check_out_at is null
      and check_out_latitude is null
      and check_out_longitude is null
      and check_out_accuracy_meters is null
      and check_out_distance_meters is null
    )
    or (
      check_out_at is not null
      and check_out_latitude is not null
      and check_out_longitude is not null
      and check_out_accuracy_meters is not null
      and check_out_distance_meters is not null
    )
  ),
  constraint attendance_records_state_check check (
    (
      status = 'CHECKED_IN'
      and check_out_at is null
      and worked_minutes is null
      and work_deficit_minutes is null
    )
    or (
      status = 'COMPLETED'
      and check_out_at is not null
      and worked_minutes is not null
      and work_deficit_minutes is not null
    )
  )
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  leave_date date not null,
  leave_type public.leave_type not null,
  reason text not null,
  status public.leave_status not null default 'PENDING',
  decision_note text,
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_reason_length_check check (
    length(btrim(reason)) between 1 and 1000
  ),
  constraint leave_requests_decision_note_length_check check (
    decision_note is null or length(btrim(decision_note)) between 1 and 1000
  ),
  constraint leave_requests_decision_state_check check (
    (
      status in ('PENDING', 'CANCELLED')
      and decided_by is null
      and decided_at is null
    )
    or (
      status in ('APPROVED', 'REJECTED')
      and decided_by is not null
      and decided_at is not null
    )
  )
);

create table public.attendance_admin_notes (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance_records (id) on delete restrict,
  note text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint attendance_admin_notes_note_length_check check (
    length(btrim(note)) between 1 and 2000
  )
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank_check check (
    length(btrim(action)) between 1 and 100
  ),
  constraint audit_logs_entity_type_not_blank_check check (
    length(btrim(entity_type)) between 1 and 100
  )
);

create index schedule_rules_resolution_idx
  on public.schedule_rules (schedule_type, effective_from desc);
create index geofence_rules_resolution_idx
  on public.geofence_rules (effective_from desc);
create index payroll_rules_resolution_idx
  on public.payroll_rules (effective_from desc);
create index attendance_records_work_date_status_idx
  on public.attendance_records (work_date, status);
create unique index leave_requests_teacher_date_active_idx
  on public.leave_requests (teacher_id, leave_date)
  where status in ('PENDING', 'APPROVED');
create index leave_requests_status_date_idx
  on public.leave_requests (status, leave_date);
create index leave_requests_decided_by_idx
  on public.leave_requests (decided_by)
  where decided_by is not null;
create index attendance_admin_notes_attendance_id_idx
  on public.attendance_admin_notes (attendance_id);
create index attendance_admin_notes_created_by_idx
  on public.attendance_admin_notes (created_by);
create index audit_logs_actor_created_at_idx
  on public.audit_logs (actor_id, created_at desc);
create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id)
  where entity_id is not null;
create index audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.guard_versioned_rule_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.effective_to is not null
    or new.effective_to is null
    or new.effective_to < old.effective_from
    or (to_jsonb(new) - array['effective_to', 'updated_at'])
      is distinct from (to_jsonb(old) - array['effective_to', 'updated_at'])
  then
    raise exception 'Historical configuration is immutable; only an open version may be closed';
  end if;

  return new;
end;
$$;

create function private.guard_attendance_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.id,
    new.teacher_id,
    new.work_date,
    new.check_in_at,
    new.check_in_latitude,
    new.check_in_longitude,
    new.check_in_accuracy_meters,
    new.check_in_distance_meters,
    new.work_start,
    new.work_end,
    new.checkout_close,
    new.target_minutes,
    new.arrival_late_minutes,
    new.created_at
  ) is distinct from row(
    old.id,
    old.teacher_id,
    old.work_date,
    old.check_in_at,
    old.check_in_latitude,
    old.check_in_longitude,
    old.check_in_accuracy_meters,
    old.check_in_distance_meters,
    old.work_start,
    old.work_end,
    old.checkout_close,
    old.target_minutes,
    old.arrival_late_minutes,
    old.created_at
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

create function private.guard_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Append-only records cannot be updated or deleted';
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;
revoke execute on function private.guard_versioned_rule_update() from public, anon, authenticated;
revoke execute on function private.guard_attendance_update() from public, anon, authenticated;
revoke execute on function private.guard_append_only() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger schedule_rules_guard_version_update
before update on public.schedule_rules
for each row execute function private.guard_versioned_rule_update();
create trigger schedule_rules_set_updated_at
before update on public.schedule_rules
for each row execute function private.set_updated_at();

create trigger geofence_rules_guard_version_update
before update on public.geofence_rules
for each row execute function private.guard_versioned_rule_update();
create trigger geofence_rules_set_updated_at
before update on public.geofence_rules
for each row execute function private.set_updated_at();

create trigger calendar_exceptions_set_updated_at
before update on public.calendar_exceptions
for each row execute function private.set_updated_at();

create trigger payroll_rules_guard_version_update
before update on public.payroll_rules
for each row execute function private.guard_versioned_rule_update();
create trigger payroll_rules_set_updated_at
before update on public.payroll_rules
for each row execute function private.set_updated_at();

create trigger attendance_records_guard_update
before update on public.attendance_records
for each row execute function private.guard_attendance_update();
create trigger attendance_records_set_updated_at
before update on public.attendance_records
for each row execute function private.set_updated_at();

create trigger leave_requests_set_updated_at
before update on public.leave_requests
for each row execute function private.set_updated_at();

create trigger attendance_admin_notes_guard_append_only
before update or delete on public.attendance_admin_notes
for each row execute function private.guard_append_only();
create trigger audit_logs_guard_append_only
before update or delete on public.audit_logs
for each row execute function private.guard_append_only();

alter table public.profiles enable row level security;
alter table public.schedule_rules enable row level security;
alter table public.geofence_rules enable row level security;
alter table public.calendar_exceptions enable row level security;
alter table public.payroll_rules enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_admin_notes enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN'
);

create policy schedule_rules_select_admin
on public.schedule_rules
for select
to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN');

create policy geofence_rules_select_admin
on public.geofence_rules
for select
to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN');

create policy calendar_exceptions_select_admin
on public.calendar_exceptions
for select
to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN');

create policy payroll_rules_select_admin
on public.payroll_rules
for select
to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN');

create policy attendance_records_select_own_or_admin
on public.attendance_records
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN'
);

create policy leave_requests_select_own_or_admin
on public.leave_requests
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN'
);

create policy attendance_admin_notes_select_own_or_admin
on public.attendance_admin_notes
for select
to authenticated
using (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN'
  or exists (
    select 1
    from public.attendance_records
    where attendance_records.id = attendance_admin_notes.attendance_id
      and attendance_records.teacher_id = (select auth.uid())
  )
);

create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN');

revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.schedule_rules from anon, authenticated;
revoke all privileges on table public.geofence_rules from anon, authenticated;
revoke all privileges on table public.calendar_exceptions from anon, authenticated;
revoke all privileges on table public.payroll_rules from anon, authenticated;
revoke all privileges on table public.attendance_records from anon, authenticated;
revoke all privileges on table public.leave_requests from anon, authenticated;
revoke all privileges on table public.attendance_admin_notes from anon, authenticated;
revoke all privileges on table public.audit_logs from anon, authenticated;

grant usage on schema public to authenticated;
grant usage on type public.user_role to authenticated;
grant usage on type public.schedule_type to authenticated;
grant usage on type public.calendar_exception_type to authenticated;
grant usage on type public.attendance_status to authenticated;
grant usage on type public.leave_type to authenticated;
grant usage on type public.leave_status to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.schedule_rules to authenticated;
grant select on table public.geofence_rules to authenticated;
grant select on table public.calendar_exceptions to authenticated;
grant select on table public.payroll_rules to authenticated;
grant select on table public.attendance_records to authenticated;
grant select on table public.leave_requests to authenticated;
grant select on table public.attendance_admin_notes to authenticated;
grant select on table public.audit_logs to authenticated;

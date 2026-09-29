create type public.payroll_calculation_mode as enum (
  'LEGACY_PER_MINUTE',
  'MONTHLY_POLICY'
);

create type public.early_departure_status as enum (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

alter table public.payroll_rules
  add column calculation_mode public.payroll_calculation_mode
    not null default 'LEGACY_PER_MINUTE',
  add column minimum_performance_pay numeric(14, 2) not null default 0,
  add column late_deduction_amount numeric(14, 2) not null default 0,
  add column absent_deduction_amount numeric(14, 2) not null default 0,
  add column rejected_early_departure_rate_per_hour numeric(14, 2)
    not null default 0,
  add constraint payroll_rules_minimum_pay_check check (
    minimum_performance_pay >= 0
    and minimum_performance_pay <= base_performance_pay
  ),
  add constraint payroll_rules_late_deduction_check check (
    late_deduction_amount >= 0
  ),
  add constraint payroll_rules_absent_deduction_check check (
    absent_deduction_amount >= 0
  ),
  add constraint payroll_rules_early_departure_rate_check check (
    rejected_early_departure_rate_per_hour >= 0
  ),
  add constraint payroll_rules_mode_fields_check check (
    (
      calculation_mode = 'LEGACY_PER_MINUTE'
      and minimum_performance_pay = 0
      and late_deduction_amount = 0
      and absent_deduction_amount = 0
      and rejected_early_departure_rate_per_hour = 0
    )
    or (
      calculation_mode = 'MONTHLY_POLICY'
      and deduction_rate_per_minute = 0
    )
  );

create table public.early_departure_requests (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null unique
    references public.attendance_records (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  work_date date not null,
  requested_at timestamptz not null,
  reason text not null,
  latitude numeric(9, 6) not null,
  longitude numeric(10, 6) not null,
  accuracy_meters numeric(10, 2) not null,
  distance_meters numeric(10, 2) not null,
  status public.early_departure_status not null default 'PENDING',
  decision_note text,
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint early_departure_requests_reason_check check (
    length(btrim(reason)) between 1 and 1000
  ),
  constraint early_departure_requests_latitude_check check (
    latitude between -90 and 90
  ),
  constraint early_departure_requests_longitude_check check (
    longitude between -180 and 180
  ),
  constraint early_departure_requests_accuracy_check check (
    accuracy_meters >= 0
  ),
  constraint early_departure_requests_distance_check check (
    distance_meters >= 0
  ),
  constraint early_departure_requests_decision_note_check check (
    decision_note is null or length(btrim(decision_note)) between 1 and 1000
  ),
  constraint early_departure_requests_decision_state_check check (
    (
      status = 'PENDING'
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

create index early_departure_requests_teacher_work_date_idx
  on public.early_departure_requests (teacher_id, work_date desc);
create index early_departure_requests_status_requested_at_idx
  on public.early_departure_requests (status, requested_at);
create index early_departure_requests_decided_by_idx
  on public.early_departure_requests (decided_by)
  where decided_by is not null;

create function private.guard_early_departure_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.attendance_id <> old.attendance_id
    or new.teacher_id <> old.teacher_id
    or new.work_date <> old.work_date
    or new.requested_at <> old.requested_at
    or new.reason <> old.reason
    or new.latitude <> old.latitude
    or new.longitude <> old.longitude
    or new.accuracy_meters <> old.accuracy_meters
    or new.distance_meters <> old.distance_meters then
    raise exception using
      errcode = 'P0001',
      message = 'Early departure request data is immutable';
  end if;

  if old.status <> 'PENDING'
    or new.status not in ('APPROVED', 'REJECTED') then
    raise exception using
      errcode = 'P0001',
      message = 'EARLY_DEPARTURE_NOT_PENDING';
  end if;

  return new;
end;
$$;

create function private.audit_early_departure_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values (
    case when tg_op = 'INSERT' then new.teacher_id else new.decided_by end,
    case
      when tg_op = 'INSERT' then 'EARLY_DEPARTURE_REQUEST_CREATED'
      when new.status = 'APPROVED' then 'EARLY_DEPARTURE_REQUEST_APPROVED'
      else 'EARLY_DEPARTURE_REQUEST_REJECTED'
    end,
    'early_departure_requests',
    new.id,
    case when tg_op = 'INSERT' then null else pg_catalog.jsonb_build_object(
      'status', old.status
    ) end,
    pg_catalog.jsonb_build_object(
      'teacherId', new.teacher_id,
      'workDate', new.work_date,
      'requestedAt', new.requested_at,
      'status', new.status,
      'decidedBy', new.decided_by,
      'decidedAt', new.decided_at
    )
  );

  return new;
end;
$$;

create trigger early_departure_requests_guard_update
before update on public.early_departure_requests
for each row execute function private.guard_early_departure_request_update();

create trigger early_departure_requests_set_updated_at
before update on public.early_departure_requests
for each row execute function private.set_updated_at();

create trigger early_departure_requests_audit
after insert or update on public.early_departure_requests
for each row execute function private.audit_early_departure_request();

alter table public.early_departure_requests enable row level security;

create policy early_departure_requests_select_own_or_admin
on public.early_departure_requests
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN'
);

revoke all privileges on table public.early_departure_requests
from anon, authenticated;
grant select on table public.early_departure_requests to authenticated;

grant usage on type public.payroll_calculation_mode to service_role;
grant usage on type public.early_departure_status to service_role;
grant select, insert, update
on table public.early_departure_requests
to service_role;

create function public.create_early_departure_request(
  p_teacher_id uuid,
  p_reason text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_distance_meters numeric
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
    distance_meters
  ) values (
    attendance.id,
    p_teacher_id,
    server_work_date,
    server_now,
    p_reason,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_distance_meters
  ) returning * into request;

  update public.attendance_records
  set
    check_out_at = server_now,
    check_out_latitude = p_latitude,
    check_out_longitude = p_longitude,
    check_out_accuracy_meters = p_accuracy_meters,
    check_out_distance_meters = p_distance_meters,
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

drop function public.create_payroll_rule_version(uuid, date, numeric, numeric);

create function public.create_payroll_rule_version(
  p_actor_id uuid,
  p_effective_from date,
  p_base_performance_pay numeric,
  p_minimum_performance_pay numeric,
  p_late_deduction_amount numeric,
  p_absent_deduction_amount numeric,
  p_rejected_early_departure_rate_per_hour numeric
)
returns public.payroll_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_payroll public.payroll_rules%rowtype;
  new_payroll public.payroll_rules%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('absensi.payroll_rules.version', 0)
  );

  if p_effective_from <
    (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_DATE_IN_PAST';
  end if;
  if p_effective_from is null
    or p_effective_from <> pg_catalog.date_trunc('month', p_effective_from)::date
    or exists (
      select 1 from public.payroll_rules where effective_from >= p_effective_from
    ) then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_DATE_CONFLICT';
  end if;

  select * into old_payroll
  from public.payroll_rules
  where effective_to is null
  order by effective_from desc
  limit 1
  for update;

  update public.payroll_rules
  set effective_to = p_effective_from - 1
  where effective_to is null;

  insert into public.payroll_rules (
    calculation_mode,
    base_performance_pay,
    minimum_performance_pay,
    deduction_rate_per_minute,
    late_deduction_amount,
    absent_deduction_amount,
    rejected_early_departure_rate_per_hour,
    effective_from
  ) values (
    'MONTHLY_POLICY',
    p_base_performance_pay,
    p_minimum_performance_pay,
    0,
    p_late_deduction_amount,
    p_absent_deduction_amount,
    p_rejected_early_departure_rate_per_hour,
    p_effective_from
  ) returning * into new_payroll;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_id,
    'PAYROLL_RULE_VERSION_CREATED',
    'payroll_rules',
    new_payroll.id,
    case when old_payroll.id is null then null else pg_catalog.jsonb_build_object(
      'calculationMode', old_payroll.calculation_mode,
      'basePerformancePay', old_payroll.base_performance_pay,
      'minimumPerformancePay', old_payroll.minimum_performance_pay,
      'lateDeductionAmount', old_payroll.late_deduction_amount,
      'absentDeductionAmount', old_payroll.absent_deduction_amount,
      'rejectedEarlyDepartureRatePerHour',
        old_payroll.rejected_early_departure_rate_per_hour,
      'effectiveFrom', old_payroll.effective_from,
      'effectiveTo', old_payroll.effective_to
    ) end,
    pg_catalog.jsonb_build_object(
      'calculationMode', new_payroll.calculation_mode,
      'basePerformancePay', new_payroll.base_performance_pay,
      'minimumPerformancePay', new_payroll.minimum_performance_pay,
      'lateDeductionAmount', new_payroll.late_deduction_amount,
      'absentDeductionAmount', new_payroll.absent_deduction_amount,
      'rejectedEarlyDepartureRatePerHour',
        new_payroll.rejected_early_departure_rate_per_hour,
      'effectiveFrom', new_payroll.effective_from,
      'effectiveTo', new_payroll.effective_to
    )
  );

  return new_payroll;
end;
$$;

revoke execute on function private.guard_early_departure_request_update()
from public, anon, authenticated;
revoke execute on function private.audit_early_departure_request()
from public, anon, authenticated;

revoke all on function public.create_early_departure_request(
  uuid, text, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.create_early_departure_request(
  uuid, text, numeric, numeric, numeric, numeric
) to service_role;

revoke all on function public.create_payroll_rule_version(
  uuid, date, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.create_payroll_rule_version(
  uuid, date, numeric, numeric, numeric, numeric, numeric
) to service_role;

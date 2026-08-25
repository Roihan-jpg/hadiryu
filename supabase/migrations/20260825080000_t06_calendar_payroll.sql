grant usage on type public.calendar_exception_type to service_role;

grant select, insert, update, delete
on table public.calendar_exceptions
to service_role;

grant select, insert, update
on table public.payroll_rules
to service_role;

create function public.create_calendar_exception(
  p_actor_id uuid,
  p_work_date date,
  p_exception_type public.calendar_exception_type,
  p_name text,
  p_schedule_type public.schedule_type
)
returns public.calendar_exceptions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_exception public.calendar_exceptions%rowtype;
begin
  if p_work_date < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'CALENDAR_DATE_IN_PAST';
  end if;

  if exists (select 1 from public.calendar_exceptions where work_date = p_work_date) then
    raise exception using errcode = 'P0001', message = 'CALENDAR_DATE_CONFLICT';
  end if;

  insert into public.calendar_exceptions (
    work_date,
    exception_type,
    name,
    schedule_type
  ) values (
    p_work_date,
    p_exception_type,
    p_name,
    p_schedule_type
  ) returning * into new_exception;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_id,
    'CALENDAR_EXCEPTION_CREATED',
    'calendar_exceptions',
    new_exception.id,
    null,
    pg_catalog.jsonb_build_object(
      'workDate', new_exception.work_date,
      'exceptionType', new_exception.exception_type,
      'name', new_exception.name,
      'scheduleType', new_exception.schedule_type
    )
  );

  return new_exception;
end;
$$;

create function public.update_calendar_exception(
  p_actor_id uuid,
  p_id uuid,
  p_work_date date,
  p_exception_type public.calendar_exception_type,
  p_name text,
  p_schedule_type public.schedule_type
)
returns public.calendar_exceptions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_exception public.calendar_exceptions%rowtype;
  new_exception public.calendar_exceptions%rowtype;
begin
  select * into old_exception
  from public.calendar_exceptions
  where id = p_id
  for update;

  if old_exception.id is null then
    raise exception using errcode = 'P0001', message = 'CALENDAR_EXCEPTION_NOT_FOUND';
  end if;

  if old_exception.work_date < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date
    or p_work_date < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'CALENDAR_DATE_IN_PAST';
  end if;

  if exists (
    select 1 from public.calendar_exceptions
    where work_date = p_work_date and id <> p_id
  ) then
    raise exception using errcode = 'P0001', message = 'CALENDAR_DATE_CONFLICT';
  end if;

  update public.calendar_exceptions
  set
    work_date = p_work_date,
    exception_type = p_exception_type,
    name = p_name,
    schedule_type = p_schedule_type
  where id = p_id
  returning * into new_exception;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_id,
    'CALENDAR_EXCEPTION_UPDATED',
    'calendar_exceptions',
    new_exception.id,
    pg_catalog.jsonb_build_object(
      'workDate', old_exception.work_date,
      'exceptionType', old_exception.exception_type,
      'name', old_exception.name,
      'scheduleType', old_exception.schedule_type
    ),
    pg_catalog.jsonb_build_object(
      'workDate', new_exception.work_date,
      'exceptionType', new_exception.exception_type,
      'name', new_exception.name,
      'scheduleType', new_exception.schedule_type
    )
  );

  return new_exception;
end;
$$;

create function public.delete_calendar_exception(p_actor_id uuid, p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_exception public.calendar_exceptions%rowtype;
begin
  select * into old_exception
  from public.calendar_exceptions
  where id = p_id
  for update;

  if old_exception.id is null then
    raise exception using errcode = 'P0001', message = 'CALENDAR_EXCEPTION_NOT_FOUND';
  end if;

  if old_exception.work_date < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'CALENDAR_DATE_IN_PAST';
  end if;

  delete from public.calendar_exceptions where id = p_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_id,
    'CALENDAR_EXCEPTION_DELETED',
    'calendar_exceptions',
    p_id,
    pg_catalog.jsonb_build_object(
      'workDate', old_exception.work_date,
      'exceptionType', old_exception.exception_type,
      'name', old_exception.name,
      'scheduleType', old_exception.schedule_type
    ),
    null
  );
end;
$$;

create function public.create_payroll_rule_version(
  p_actor_id uuid,
  p_effective_from date,
  p_base_performance_pay numeric,
  p_deduction_rate_per_minute numeric
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

  if p_effective_from < (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'EFFECTIVE_DATE_IN_PAST';
  end if;

  if p_effective_from is null
    or p_effective_from <> pg_catalog.date_trunc('month', p_effective_from)::date
    or exists (select 1 from public.payroll_rules where effective_from >= p_effective_from) then
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
    base_performance_pay,
    deduction_rate_per_minute,
    effective_from
  ) values (
    p_base_performance_pay,
    p_deduction_rate_per_minute,
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
      'basePerformancePay', old_payroll.base_performance_pay,
      'deductionRatePerMinute', old_payroll.deduction_rate_per_minute,
      'effectiveFrom', old_payroll.effective_from,
      'effectiveTo', old_payroll.effective_to
    ) end,
    pg_catalog.jsonb_build_object(
      'basePerformancePay', new_payroll.base_performance_pay,
      'deductionRatePerMinute', new_payroll.deduction_rate_per_minute,
      'effectiveFrom', new_payroll.effective_from,
      'effectiveTo', new_payroll.effective_to
    )
  );

  return new_payroll;
end;
$$;

revoke all on function public.create_calendar_exception(
  uuid, date, public.calendar_exception_type, text, public.schedule_type
) from public, anon, authenticated;
grant execute on function public.create_calendar_exception(
  uuid, date, public.calendar_exception_type, text, public.schedule_type
) to service_role;

revoke all on function public.update_calendar_exception(
  uuid, uuid, date, public.calendar_exception_type, text, public.schedule_type
) from public, anon, authenticated;
grant execute on function public.update_calendar_exception(
  uuid, uuid, date, public.calendar_exception_type, text, public.schedule_type
) to service_role;

revoke all on function public.delete_calendar_exception(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.delete_calendar_exception(uuid, uuid) to service_role;

revoke all on function public.create_payroll_rule_version(uuid, date, numeric, numeric)
from public, anon, authenticated;
grant execute on function public.create_payroll_rule_version(uuid, date, numeric, numeric)
to service_role;
